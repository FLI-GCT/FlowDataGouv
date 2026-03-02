/**
 * GET /api/catalog/summary — Lightweight catalog summary for homepage.
 *
 * Returns stats, category list, top datasets, category rankings,
 * geo regions, and sync date. ~50KB instead of 30MB full catalog.
 */

import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { Catalog } from "@/lib/sync/catalog";

interface CatalogSummary {
  lastSync: string;
  stats: Catalog["stats"];
  categories: { slug: string; label: string; totalItems: number; color: string; description: string }[];
  topDatasets: Catalog["topDatasets"];
  categoryStats: Catalog["categoryStats"];
  geoRegions: Catalog["geoRegions"];
}

let cached: { data: CatalogSummary; mtime: number } | null = null;

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "catalog.json");

  try {
    const stat = await fs.stat(filePath);
    const mtime = stat.mtimeMs;

    if (cached && cached.mtime === mtime) {
      return NextResponse.json(cached.data, {
        headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=300" },
      });
    }

    const raw = await fs.readFile(filePath, "utf-8");
    const catalog: Catalog = JSON.parse(raw);

    const summary: CatalogSummary = {
      lastSync: catalog.lastSync,
      stats: catalog.stats,
      categories: catalog.categories.map((c) => ({
        slug: c.slug,
        label: c.label,
        totalItems: c.totalItems,
        color: c.color,
        description: c.description,
      })),
      topDatasets: catalog.topDatasets,
      categoryStats: catalog.categoryStats,
      geoRegions: (catalog.geoRegions || []).slice(0, 20),
    };

    cached = { data: summary, mtime };

    return NextResponse.json(summary, {
      headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json(
      { error: "Catalogue non disponible." },
      { status: 404 }
    );
  }
}
