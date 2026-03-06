/**
 * POST /api/catalog/search — Faceted search over 73k+ enriched datasets.
 *
 * Accepts: { query?, categories?, subcategories?, geoScopes?, geoAreas?, types?, licenses?, sort?, sortDir?, page?, pageSize? }
 * Returns: { items[], total, page, pageSize, facets{}, expansion? }
 *
 * If `query` is provided, it's expanded via Mistral (correction + keywords + suggested filters)
 * then scored against the in-memory index with word-boundary matching.
 */

import { NextResponse } from "next/server";
import { searchEngine } from "@/lib/catalog/search-engine";
import { expandSearchQuery, isExpansionCached, type SearchExpansion } from "@/lib/search/expand";
import { rerankResults, isRerankCached } from "@/lib/search/rerank";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const maxDuration = 30;

interface SearchRequest {
  query?: string;
  categories?: string[];
  subcategories?: string[];
  geoScopes?: string[];
  geoAreas?: string[];
  types?: ("dataset" | "dataservice")[];
  licenses?: string[];
  dateAfter?: string;
  qualityMin?: number;
  sort?: "relevance" | "views" | "downloads" | "lastModified" | "quality";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function POST(request: Request) {
  try {
    const body: SearchRequest = await request.json();
    const t0 = Date.now();

    // Expand query via Mistral if text search
    let expansion: SearchExpansion | undefined;
    let keywords: string[] | undefined;

    if (body.query?.trim()) {
      // Only count against quota when Mistral will actually be called (not all cached)
      if (!isExpansionCached(body.query.trim()) || !isRerankCached(body.query.trim())) {
        const rl = checkRateLimit(getClientIp(request));
        if (!rl.success) {
          return NextResponse.json(
            { error: "Trop de requêtes. Réessayez dans 24h." },
            {
              status: 429,
              headers: {
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": String(rl.reset),
                "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)),
              },
            }
          );
        }
      }
      expansion = await expandSearchQuery(body.query.trim());
      keywords = expansion.keywords ? [...expansion.keywords] : [];

      // Inject geo area names as keywords for scoring boost
      // (so "Yonne" boosts items mentioning Yonne without strict filtering)
      if (expansion.suggestedFilters?.geoAreas?.length) {
        for (const area of expansion.suggestedFilters.geoAreas) {
          if (!keywords.some((k) => k.toLowerCase() === area.toLowerCase())) {
            keywords.push(area);
          }
        }
      }

      // Ensure we have at least some keywords
      if (keywords.length === 0) {
        keywords = [body.query.trim()];
      }
    }

    // Filters are applied as-is from the frontend (including Mistral auto-checked ones)
    const result = await searchEngine.search({
      keywords,
      categories: body.categories,
      subcategories: body.subcategories,
      geoScopes: body.geoScopes,
      geoAreas: body.geoAreas,
      types: body.types,
      licenses: body.licenses,
      dateAfter: body.dateAfter,
      qualityMin: body.qualityMin,
      sort: body.sort,
      sortDir: body.sortDir,
      page: body.page,
      pageSize: body.pageSize,
    });

    // Re-rank page 1 via Mistral (semantic relevance)
    let reranked = false;
    const sort = body.sort || (keywords ? "relevance" : "downloads");
    if (sort === "relevance" && (body.page || 1) === 1
        && result.items.length >= 5 && expansion?.wasExpanded) {
      const rr = await rerankResults(
        body.query!.trim(),
        expansion.corrected,
        result.items.slice(0, 20),
      );
      if (rr.wasReranked) {
        const idOrder = new Map(rr.rerankedIds.map((id, i) => [id, i]));
        result.items.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
        reranked = true;
      }
    }

    const ms = Date.now() - t0;

    // Consolidated search log — every query, always
    const parts: string[] = [`q="${body.query || ""}"`];
    if (expansion) {
      if (expansion.corrected !== body.query) parts.push(`corrected="${expansion.corrected}"`);
      parts.push(`kw=[${expansion.keywords.join(", ")}]`);
      const sf = expansion.suggestedFilters;
      const autoF = [
        sf?.categories?.length && `cat=${sf.categories.join(",")}`,
        sf?.geoScopes?.length && `geo=${sf.geoScopes.join(",")}`,
        sf?.geoAreas?.length && `area=${sf.geoAreas.join(",")}`,
      ].filter(Boolean);
      if (autoF.length) parts.push(`mistral=[${autoF.join(", ")}]`);
      if (!expansion.wasExpanded) parts.push("(fallback)");
    }
    const userFilters = [
      body.categories?.length && `cat=${body.categories.join(",")}`,
      body.geoScopes?.length && `geo=${body.geoScopes.join(",")}`,
      body.geoAreas?.length && `area=${body.geoAreas.join(",")}`,
      body.types?.length && `type=${body.types.join(",")}`,
      body.dateAfter && `after=${body.dateAfter}`,
      body.qualityMin && `quality>=${body.qualityMin}`,
    ].filter(Boolean);
    if (userFilters.length) parts.push(`filters=[${userFilters.join(", ")}]`);
    parts.push(`→ ${result.total} results`);
    if (reranked) parts.push("(reranked)");
    parts.push(`(${ms}ms)`);
    // Top 3 titles for quick analysis
    const top3 = result.items.slice(0, 3).map((it, i) =>
      `  ${i + 1}. "${it.title.slice(0, 60)}" [${it.score?.toFixed(1) || "-"}] ${it.views}v`
    );
    console.error(`[search] ${parts.join(" ")}\n${top3.join("\n")}`);

    return NextResponse.json({
      ...result,
      ...(expansion ? { expansion } : {}),
      ...(reranked ? { reranked: true } : {}),
    });
  } catch (err) {
    console.error("[catalog/search] Error:", err);
    return NextResponse.json(
      { error: "Erreur de recherche" },
      { status: 500 }
    );
  }
}
