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
import { expandSearchQuery, type SearchExpansion } from "@/lib/search/expand";

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

    const ms = Date.now() - t0;
    if (expansion?.wasExpanded) {
      const kw = expansion.keywords.join(", ");
      const corr = expansion.corrected !== body.query ? ` corrected="${expansion.corrected}"` : "";
      const sf = expansion.suggestedFilters;
      const autoFilters = [
        sf?.categories?.length && `cat=${sf.categories.join(",")}`,
        sf?.geoScopes?.length && `geo=${sf.geoScopes.join(",")}`,
        sf?.geoAreas?.length && `area=${sf.geoAreas.join(",")}`,
      ].filter(Boolean);
      console.error(
        `[mistral] "${body.query}"${corr} keywords=[${kw}]${autoFilters.length ? ` filters=[${autoFilters.join(", ")}]` : ""}`
      );
    }
    const filters = [
      body.categories?.length && `cat=${body.categories.join(",")}`,
      body.geoScopes?.length && `geo=${body.geoScopes.join(",")}`,
      body.geoAreas?.length && `area=${body.geoAreas.join(",")}`,
      body.types?.length && `type=${body.types.join(",")}`,
      body.dateAfter && `after=${body.dateAfter}`,
      body.qualityMin && `quality>=${body.qualityMin}`,
    ].filter(Boolean);
    console.error(
      `[search] q="${body.query || ""}" → ${result.total} results (${ms}ms)${filters.length ? ` [${filters.join(", ")}]` : ""}`
    );

    return NextResponse.json({
      ...result,
      ...(expansion ? { expansion } : {}),
    });
  } catch (err) {
    console.error("[catalog/search] Error:", err);
    return NextResponse.json(
      { error: "Erreur de recherche" },
      { status: 500 }
    );
  }
}
