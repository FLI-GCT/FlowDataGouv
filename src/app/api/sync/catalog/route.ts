import { NextResponse } from "next/server";
import { syncCatalog } from "@/lib/sync/catalog";

/**
 * POST /api/sync/catalog
 *
 * Pipeline de sync du catalogue (73k+ datasets data.gouv.fr) :
 *   1. Fetch   — recupere les nouveaux datasets/APIs depuis data.gouv.fr
 *   2. Enrich  — categorise par batch de 10 via Mistral (cat, sub, sub2, geo, resume, qualite)
 *   3. Normalize — Mistral Large clusterise les sous-categories libres en groupes canoniques
 *   4. Build   — reconstruit data/catalog.json (taxonomie 3 niveaux, stats, geo)
 *
 * Query params:
 *   ?enrich_only=true      — skip fetch, enrich + rebuild uniquement
 *   ?rebuild_only=true     — skip fetch + enrich, rebuild catalog uniquement
 *   ?max=5000              — limiter le nombre d'enrichissements par run
 *   ?reset=true            — effacer tous les enrichissements (re-enrichir from scratch)
 *   ?normalize=true        — lancer la normalisation taxonomique (incremental par defaut)
 *   ?force_normalize=true  — forcer une re-normalisation complete (ignorer taxonomy existante)
 *   ?normalize_model=X     — modele pour normalisation (defaut: mistral-large-latest)
 *
 * Protected by SYNC_SECRET env var.
 *
 * Usage:
 *   # Full sync
 *   curl -X POST http://localhost:3000/api/sync/catalog \
 *     -H "Authorization: Bearer $SYNC_SECRET"
 *
 *   # Enrich-only (skip re-fetch)
 *   curl -X POST "http://localhost:3000/api/sync/catalog?enrich_only=true&max=10000" \
 *     -H "Authorization: Bearer $SYNC_SECRET"
 *
 *   # Reset + re-enrichir tout
 *   curl -X POST "http://localhost:3000/api/sync/catalog?enrich_only=true&reset=true&max=73000" \
 *     -H "Authorization: Bearer $SYNC_SECRET"
 *
 *   # Normalisation seule (apres enrichissement)
 *   curl -X POST "http://localhost:3000/api/sync/catalog?rebuild_only=true&normalize=true" \
 *     -H "Authorization: Bearer $SYNC_SECRET"
 */
export async function POST(request: Request) {
  // Auth check — SYNC_SECRET is mandatory
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SYNC_SECRET non configuré. Endpoint désactivé." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse options from query params
  const url = new URL(request.url);
  const enrichOnly = url.searchParams.get("enrich_only") === "true";
  const rebuildOnly = url.searchParams.get("rebuild_only") === "true";
  const normalize = url.searchParams.get("normalize") === "true";
  const forceNormalize = url.searchParams.get("force_normalize") === "true";
  const reset = url.searchParams.get("reset") === "true";
  const normalizeModel = url.searchParams.get("normalize_model") || undefined;
  const maxEnrich = url.searchParams.has("max")
    ? parseInt(url.searchParams.get("max")!, 10)
    : undefined;

  try {
    const catalog = await syncCatalog({
      skipFetch: enrichOnly,
      rebuildOnly,
      normalize,
      normalizeModel,
      forceNormalize,
      reset,
      maxEnrich: maxEnrich && !isNaN(maxEnrich) ? maxEnrich : undefined,
    });

    return NextResponse.json({
      ok: true,
      stats: catalog.stats,
      lastSync: catalog.lastSync,
      geoRegions: catalog.geoRegions.length,
      categories: catalog.categories.map((c) => ({
        slug: c.slug,
        label: c.label,
        count: c.totalItems,
        subcategories: c.subcategories.length,
      })),
    });
  } catch (error) {
    console.error("[sync/catalog] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 }
    );
  }
}

// Long timeout for full sync (73k+ datasets + enrichment)
export const maxDuration = 600;
