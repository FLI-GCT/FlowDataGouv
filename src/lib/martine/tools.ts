/**
 * Martine v2 — 6 LLM-friendly tools with pre-digested responses.
 *
 * Each tool calls existing FlowDataGouv APIs/engines directly (no HTTP round-trip)
 * and returns compact JSON optimized for Mistral tool calling.
 */

import { searchEngine } from "@/lib/catalog/search-engine";
import {
  getDatasetInfo,
  listDatasetResources,
  getMetrics,
  getResourceSchema,
  queryResourceData,
  downloadAndParseResource,
  getResourceInfo,
} from "@/lib/datagouv/api";
import * as fs from "fs/promises";
import * as path from "path";
import type { Catalog } from "@/lib/sync/catalog";

// ── Catalog cache (for categories + stats) ─────────────────────

let catalogCache: { data: Catalog; mtime: number } | null = null;

async function loadCatalog(): Promise<Catalog> {
  const filePath = path.join(process.cwd(), "data", "catalog.json");
  const stat = await fs.stat(filePath);
  if (catalogCache && catalogCache.mtime === stat.mtimeMs) return catalogCache.data;
  const raw = await fs.readFile(filePath, "utf-8");
  const catalog: Catalog = JSON.parse(raw);
  catalogCache = { data: catalog, mtime: stat.mtimeMs };
  return catalog;
}

// ── Tool definitions (Mistral function calling format) ──────────

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_datasets",
      description:
        "Recherche dans le catalogue de 73 000+ datasets et APIs ouvertes françaises. " +
        "Retourne les résultats les plus pertinents avec titre, organisation, catégorie et résumé.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mots-clés de recherche en français" },
          category: {
            type: "string",
            description: "Filtrer par catégorie (optionnel)",
            enum: [
              "environnement", "transport-mobilite", "sante", "education-recherche",
              "economie-emploi", "logement-urbanisme", "agriculture-alimentation",
              "culture-patrimoine", "justice-securite", "collectivites-administration",
              "finances-fiscalite", "geographie-cartographie", "energie",
              "social-solidarite", "tourisme-loisirs-sport", "numerique-technologie",
              "elections-democratie", "divers",
            ],
          },
          geo_area: { type: "string", description: "Zone géographique (ex: Lyon, Île-de-France)" },
          max_results: { type: "number", description: "Nombre max de résultats (défaut: 8, max: 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "dataset_details",
      description:
        "Informations détaillées sur un dataset : métadonnées, liste des ressources (fichiers) " +
        "et métriques de popularité. Utiliser après search_datasets pour approfondir.",
      parameters: {
        type: "object",
        properties: {
          dataset_id: { type: "string", description: "Identifiant du dataset (24 caractères hex)" },
        },
        required: ["dataset_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "explore_data",
      description:
        "Aperçu du contenu d'une ressource tabulaire : schéma (colonnes, types) + 10 premières lignes. " +
        "Appeler AVANT filter_data pour connaître les colonnes disponibles.",
      parameters: {
        type: "object",
        properties: {
          resource_id: { type: "string", description: "Identifiant de la ressource (UUID)" },
        },
        required: ["resource_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "filter_data",
      description:
        "Interroge les données tabulaires d'une ressource avec un filtre. Retourne max 20 lignes. " +
        "Appeler explore_data d'abord pour connaître les noms exacts des colonnes.",
      parameters: {
        type: "object",
        properties: {
          resource_id: { type: "string", description: "Identifiant de la ressource" },
          column: { type: "string", description: "Nom exact de la colonne à filtrer" },
          value: { type: "string", description: "Valeur à chercher" },
          operator: {
            type: "string",
            description: "Opérateur de filtre (défaut: contains)",
            enum: ["exact", "contains", "less", "greater"],
          },
          sort_column: { type: "string", description: "Colonne de tri (optionnel)" },
          sort_direction: { type: "string", enum: ["asc", "desc"], description: "Direction du tri" },
          page: { type: "number", description: "Numéro de page (défaut: 1)" },
        },
        required: ["resource_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "categories",
      description: "Liste les 18 catégories thématiques du catalogue avec le nombre de datasets.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "catalog_stats",
      description:
        "Statistiques globales du catalogue : nombre total de datasets, APIs, vues, " +
        "téléchargements, top 10 datasets les plus populaires.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ── Tool handlers ───────────────────────────────────────────────

type ToolArgs = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<string>;

const handlers: Record<string, ToolHandler> = {
  search_datasets: handleSearch,
  dataset_details: handleDatasetDetails,
  explore_data: handleExploreData,
  filter_data: handleFilterData,
  categories: handleCategories,
  catalog_stats: handleCatalogStats,
};

export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  const handler = handlers[name];
  if (!handler) return JSON.stringify({ error: `Outil inconnu: ${name}` });
  try {
    return await handler(args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return JSON.stringify({ error: msg });
  }
}

// ── Handler implementations ─────────────────────────────────────

async function handleSearch(args: ToolArgs): Promise<string> {
  const query = String(args.query || "");
  const maxResults = Math.min(Number(args.max_results) || 8, 10);
  const categories = args.category ? [String(args.category)] : undefined;
  const geoAreas = args.geo_area ? [String(args.geo_area)] : undefined;

  const result = await searchEngine.search({
    keywords: query.split(/\s+/).filter(Boolean),
    categories,
    geoAreas,
    page: 1,
    pageSize: maxResults,
  });

  // Check tabular availability for each result in parallel
  // Only check CSV/XLS/JSON resources (skip large ZIP/PDF/etc.)
  const TABULAR_FORMATS = new Set(["csv", "xls", "xlsx", "json", "geojson", "ods", "tsv"]);
  const TABULAR_API = "https://tabular-api.data.gouv.fr/api/";

  const tabularChecks = await Promise.all(
    result.items.map(async (d) => {
      try {
        const resList = await Promise.race([
          listDatasetResources(d.id),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
        ]);
        // For each CSV/XLS resource, quickly probe the Tabular API profile endpoint
        const candidates = resList.resources.filter(
          (r) => TABULAR_FORMATS.has((r.format || "").toLowerCase()),
        );
        if (!candidates.length) return { id: d.id, tabularResources: [], explorableCount: 0 };

        const checks = await Promise.all(
          candidates.slice(0, 5).map(async (r) => {
            try {
              const probe = await fetch(`${TABULAR_API}resources/${r.id}/profile/`, {
                signal: AbortSignal.timeout(3000),
              });
              return probe.status === 200 ? r : null;
            } catch { return null; }
          }),
        );
        const tabular = checks.filter(Boolean) as typeof candidates;
        return {
          id: d.id,
          tabularResources: tabular.slice(0, 3).map((r) => ({
            id: r.id,
            title: r.title,
            format: r.format,
          })),
          explorableCount: tabular.length,
        };
      } catch {
        return { id: d.id, tabularResources: [], explorableCount: 0 };
      }
    }),
  );

  const tabularMap = new Map(tabularChecks.map((t) => [t.id, t]));

  return JSON.stringify({
    query,
    total: result.total,
    results: result.items.map((d, i) => {
      const tab = tabularMap.get(d.id);
      return {
        number: i + 1,
        id: d.id,
        title: d.title,
        type: d.type,
        organization: d.organization,
        category: d.categoryLabel,
        summary: d.summary?.slice(0, 120) || "",
        views: d.views,
        downloads: d.downloads,
        lastModified: d.lastModified || "inconnue",
        license: d.license || "",
        url: `https://www.data.gouv.fr/fr/datasets/${d.id}/`,
        explorableCount: tab?.explorableCount ?? 0,
        tabularResources: tab?.tabularResources ?? [],
      };
    }),
  });
}

async function handleDatasetDetails(args: ToolArgs): Promise<string> {
  const id = String(args.dataset_id);
  const TABULAR_API_URL = "https://tabular-api.data.gouv.fr/api/";
  const TAB_FORMATS = new Set(["csv", "xls", "xlsx", "json", "tsv", "ods"]);

  const [info, resList, metrics] = await Promise.all([
    getDatasetInfo(id),
    listDatasetResources(id),
    getMetrics(id).catch(() => null),
  ]);

  // Probe Tabular API for each CSV/XLS resource
  const resources = await Promise.all(
    resList.resources.slice(0, 15).map(async (r) => {
      let tabular = false;
      if (TAB_FORMATS.has((r.format || "").toLowerCase())) {
        try {
          const probe = await fetch(`${TABULAR_API_URL}resources/${r.id}/profile/`, {
            signal: AbortSignal.timeout(3000),
          });
          tabular = probe.status === 200;
        } catch { /* not available */ }
      }
      return {
        id: r.id,
        title: r.title,
        format: r.format,
        size: r.size,
        tabular,
        url: r.url,
        datasetId: id,
        datasetTitle: info.title,
      };
    }),
  );

  const explorable = resources.filter((r) => r.tabular);

  return JSON.stringify({
    id: info.id,
    title: info.title,
    organization: info.organization,
    description: info.description?.slice(0, 500),
    license: info.license,
    frequency: info.frequency,
    lastModified: info.lastModified,
    tags: info.tags?.slice(0, 10),
    url: `https://www.data.gouv.fr/fr/datasets/${info.id}/`,
    resources,
    explorable: explorable.slice(0, 5).map((r) => ({ id: r.id, title: r.title, format: r.format })),
    explorableCount: explorable.length,
    metrics: metrics
      ? { totalVisits: metrics.totalVisits, totalDownloads: metrics.totalDownloads }
      : null,
  });
}

async function handleExploreData(args: ToolArgs): Promise<string> {
  const rid = String(args.resource_id);

  // Try Tabular API first (fast, structured)
  const [schema, data] = await Promise.all([
    getResourceSchema(rid).catch(() => null),
    queryResourceData(rid, 1, 10).catch(() => null),
  ]);

  if (data?.rows?.length) {
    return JSON.stringify({
      resource_id: rid,
      columns: schema?.columns?.map((c) => ({ name: c.name, type: c.type })) ?? [],
      totalColumns: schema?.totalColumns ?? 0,
      preview: data.rows.slice(0, 10),
      totalRows: data.totalRows ?? 0,
      datasetTitle: data.datasetTitle,
    });
  }

  // Fallback: download + parse (for non-tabular resources)
  // Check file size first to avoid downloading huge files
  try {
    const info = await getResourceInfo(rid);
    const maxSize = 50 * 1024 * 1024; // 50 MB limit for download fallback
    if (info.sizeBytes && info.sizeBytes > maxSize) {
      return JSON.stringify({
        resource_id: rid,
        error: `Fichier trop volumineux (${info.size}) pour l'exploration directe. ` +
          `Cette ressource n'est pas disponible via la Tabular API. ` +
          `Format: ${info.format}. URL: ${info.url}`,
        columns: [],
        preview: [],
        totalRows: 0,
      });
    }

    const parsed = await downloadAndParseResource(rid, 10);
    return JSON.stringify({
      resource_id: rid,
      columns: parsed.columns.map((c) => ({ name: c, type: "string" })),
      totalColumns: parsed.columns.length,
      preview: parsed.rows.slice(0, 10),
      totalRows: parsed.totalRows,
      resourceTitle: parsed.resourceTitle,
      source: "download",
    });
  } catch (dlErr) {
    return JSON.stringify({
      resource_id: rid,
      error: `Données non accessibles via la Tabular API ni par téléchargement: ${dlErr instanceof Error ? dlErr.message : "erreur inconnue"}`,
      columns: schema?.columns?.map((c) => ({ name: c.name, type: c.type })) ?? [],
      preview: [],
      totalRows: 0,
    });
  }
}

async function handleFilterData(args: ToolArgs): Promise<string> {
  const rid = String(args.resource_id);
  const page = Number(args.page) || 1;
  const pageSize = 20;

  // Build filter params for queryResourceData
  const filterColumn = args.column ? String(args.column) : undefined;
  const filterValue = args.value ? String(args.value) : undefined;
  const filterOp = String(args.operator || "contains");
  const sortCol = args.sort_column ? String(args.sort_column) : undefined;
  const sortDir = args.sort_direction === "desc" ? "desc" : "asc";

  const filters = filterColumn && filterValue
    ? { column: filterColumn, value: filterValue, operator: filterOp }
    : undefined;
  const sort = sortCol ? { column: sortCol, direction: sortDir } : undefined;

  const data = await queryResourceData(rid, page, pageSize, filters, sort);

  return JSON.stringify({
    resource_id: rid,
    filters: filterColumn ? { column: filterColumn, value: filterValue, operator: filterOp } : null,
    rows: data.rows.slice(0, 20),
    columns: data.columns,
    totalRows: data.totalRows,
    page: data.page ?? page,
    hasMore: data.hasMore,
  });
}

async function handleCategories(): Promise<string> {
  const catalog = await loadCatalog();
  return JSON.stringify({
    total: catalog.categories.length,
    categories: catalog.categories
      .sort((a, b) => b.totalItems - a.totalItems)
      .map((c) => ({
        slug: c.slug,
        label: c.label,
        count: c.totalItems,
        description: c.description,
      })),
  });
}

async function handleCatalogStats(): Promise<string> {
  const catalog = await loadCatalog();
  return JSON.stringify({
    lastSync: catalog.lastSync,
    stats: {
      datasets: catalog.stats.totalDatasets,
      apis: catalog.stats.totalDataservices,
      views: catalog.stats.totalViews,
      downloads: catalog.stats.totalDownloads,
      reuses: catalog.stats.totalReuses,
      enriched: catalog.stats.enrichedCount,
    },
    topDatasets: catalog.topDatasets.slice(0, 10).map((d) => ({
      id: d.id,
      title: d.title,
      organization: d.organization,
      views: d.views,
      downloads: d.downloads,
    })),
    geoRegions: (catalog.geoRegions || []).slice(0, 10).map((g) => ({
      label: g.label,
      count: g.count,
    })),
  });
}
