import { NextResponse } from "next/server";
import { searchEngine } from "@/lib/catalog/search-engine";

const METRIC_API = "https://metric-api.data.gouv.fr/api/datasets/data/";

interface MetricRow {
  dataset_id: string;
  monthly_visit: number;
  monthly_download_resource: number;
}

/** Get YYYY-MM for a given date */
function toMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Fetch top datasets for a given month, sorted by a metric */
async function fetchMonth(
  month: string,
  sortField: "monthly_visit" | "monthly_download_resource",
  limit: number,
): Promise<MetricRow[]> {
  const params = new URLSearchParams({
    metric_month__exact: month,
    [`${sortField}__sort`]: "desc",
    page_size: String(limit),
  });
  const res = await fetch(`${METRIC_API}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map((r: Record<string, unknown>) => ({
    dataset_id: r.dataset_id as string,
    monthly_visit: (r.monthly_visit as number) || 0,
    monthly_download_resource: (r.monthly_download_resource as number) || 0,
  }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "month";
  const sort = url.searchParams.get("sort") || "visits";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "15"), 5), 30);

  const sortField = sort === "downloads" ? "monthly_download_resource" : "monthly_visit";

  const now = new Date();
  let months: string[];
  let periodLabel: string;

  switch (period) {
    case "last-month": {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      months = [toMonth(d)];
      periodLabel = months[0];
      break;
    }
    case "3months": {
      months = [0, 1, 2].map((i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        return toMonth(d);
      });
      periodLabel = `${months[months.length - 1]}..${months[0]}`;
      break;
    }
    default: {
      months = [toMonth(now)];
      periodLabel = months[0];
    }
  }

  try {
    let aggregated: Map<string, { visits: number; downloads: number }>;

    if (months.length === 1) {
      // Single month — one sorted request
      const rows = await fetchMonth(months[0], sortField, limit);
      aggregated = new Map(
        rows.map((r) => [r.dataset_id, { visits: r.monthly_visit, downloads: r.monthly_download_resource }]),
      );
    } else {
      // Multiple months — fetch all in parallel, aggregate
      const allRows = await Promise.all(
        months.map((m) => fetchMonth(m, sortField, 50)),
      );
      aggregated = new Map<string, { visits: number; downloads: number }>();
      for (const rows of allRows) {
        for (const r of rows) {
          const existing = aggregated.get(r.dataset_id) || { visits: 0, downloads: 0 };
          existing.visits += r.monthly_visit;
          existing.downloads += r.monthly_download_resource;
          aggregated.set(r.dataset_id, existing);
        }
      }
    }

    // Resolve dataset IDs to titles via search engine
    const ids = [...aggregated.keys()];
    const info = await searchEngine.resolveIds(ids);

    // Build sorted result
    const datasets = ids
      .map((id) => {
        const metrics = aggregated.get(id)!;
        const meta = info.get(id);
        return {
          id,
          title: meta?.title || id,
          organization: meta?.organization || "",
          category: meta?.category || "",
          visits: metrics.visits,
          downloads: metrics.downloads,
        };
      })
      .filter((d) => d.title !== d.id) // skip datasets not in our catalog
      .sort((a, b) => (sort === "downloads" ? b.downloads - a.downloads : b.visits - a.visits))
      .slice(0, limit);

    return NextResponse.json(
      { period: periodLabel, sort, datasets },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=600" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur API metrics";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
