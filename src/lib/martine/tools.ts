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
import { searchEntreprises, isAvailable as isSireneAvailable } from "@/lib/sirene/db";

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
      name: "query_data",
      description:
        "Interroge les données d'une ressource tabulaire. Retourne TOUJOURS le schéma (colonnes, types) " +
        "et un aperçu des données. Supporte les filtres multiples et le tri. " +
        "Sans filtre = aperçu des 10 premières lignes. Avec filtres = résultats filtrés (max 20).",
      parameters: {
        type: "object",
        properties: {
          resource_id: { type: "string", description: "Identifiant de la ressource (UUID)" },
          filters: {
            type: "array",
            description: "Filtres à appliquer (optionnel, plusieurs filtres combinés en AND)",
            items: {
              type: "object",
              properties: {
                column: { type: "string", description: "Nom de la colonne" },
                value: { type: "string", description: "Valeur à chercher" },
                operator: {
                  type: "string",
                  description: "Opérateur (défaut: contains)",
                  enum: ["exact", "contains", "less", "greater"],
                },
              },
              required: ["column", "value"],
            },
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
      name: "search_and_preview",
      description:
        "Recherche un dataset ET explore ses données en un seul appel. " +
        "Idéal pour les questions factuelles : trouver une entreprise, une valeur, un chiffre. " +
        "Cherche dans le catalogue, identifie les ressources exploitables, puis filtre les données.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Recherche catalogue (ex: 'base sirene entreprises')" },
          data_query: { type: "string", description: "Texte à chercher DANS les données (ex: 'Flow Line', 'Lyon')" },
          category: { type: "string", description: "Catégorie (optionnel)" },
          max_datasets: { type: "number", description: "Nombre max de datasets à explorer (défaut: 3, max: 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_sirene",
      description:
        "Recherche une entreprise dans la base SIRENE locale (1.3M+ entreprises françaises). " +
        "Recherche par nom, SIREN, sigle ou activité. Résultats instantanés (< 50 ms).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nom de l'entreprise ou numéro SIREN (9 chiffres)" },
          statut: {
            type: "string",
            description: "Filtrer par statut (A = Active, C = Cessée)",
            enum: ["A", "C"],
          },
          activite: { type: "string", description: "Code APE/NAF (ex: '62.01Z' pour programmation informatique)" },
          limit: { type: "number", description: "Nombre max de résultats (défaut: 10, max: 50)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_data",
      description:
        "Compare des données de plusieurs sources en parallèle. Idéal pour comparer des villes, " +
        "régions ou thématiques. Exécute toutes les recherches et explorations simultanément.",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            description: "Liste des recherches à comparer (max 4)",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Étiquette pour cette comparaison (ex: 'Lyon', 'Dijon')" },
                search_query: { type: "string", description: "Recherche catalogue" },
                data_query: { type: "string", description: "Texte à chercher dans les données (optionnel)" },
              },
              required: ["label", "search_query"],
            },
          },
        },
        required: ["queries"],
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
  query_data: handleQueryData,
  search_and_preview: handleSearchAndPreview,
  search_sirene: handleSearchSirene,
  compare_data: handleCompareData,
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

// ── Fuzzy column matching ─────────────────────────────────────

function normalizeColName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[_\- ]/g, ""); // strip separators
}

function findClosestColumn(requested: string, available: string[]): string | null {
  const norm = normalizeColName(requested);
  // Exact match (case-insensitive, accent-insensitive)
  const exact = available.find((c) => normalizeColName(c) === norm);
  if (exact) return exact;
  // Substring match (requested is contained in column name or vice versa)
  const partial = available.find((c) => {
    const cn = normalizeColName(c);
    return cn.includes(norm) || norm.includes(cn);
  });
  return partial || null;
}

// ── Unified query_data handler ───────────────────────────────

async function handleQueryData(args: ToolArgs): Promise<string> {
  const rid = String(args.resource_id);
  const page = Number(args.page) || 1;
  const rawFilters = Array.isArray(args.filters) ? args.filters as Array<{ column: string; value: string; operator?: string }> : [];
  const hasFilters = rawFilters.length > 0;
  const pageSize = hasFilters ? 20 : 10;
  const sortCol = args.sort_column ? String(args.sort_column) : undefined;
  const sortDir = args.sort_direction === "desc" ? "desc" : "asc";

  // Always fetch schema in parallel with data
  const schema = await getResourceSchema(rid).catch(() => null);
  const availableColumns = schema?.columns?.map((c) => c.name) || [];

  // Fuzzy-match filter column names
  const corrections: Array<{ requested: string; corrected: string }> = [];
  const resolvedFilters: Array<{ column: string; value: string; operator?: string }> = [];

  for (const f of rawFilters) {
    if (availableColumns.length && !availableColumns.includes(f.column)) {
      const match = findClosestColumn(f.column, availableColumns);
      if (match) {
        corrections.push({ requested: f.column, corrected: match });
        resolvedFilters.push({ column: match, value: f.value, operator: f.operator });
      } else {
        // Column not found — return schema with error
        return JSON.stringify({
          resource_id: rid,
          error: `Colonne "${f.column}" introuvable`,
          suggestion: availableColumns.slice(0, 10),
          columns: schema?.columns?.map((c) => ({ name: c.name, type: c.type })) ?? [],
          totalColumns: schema?.totalColumns ?? 0,
          rows: [],
          totalRows: 0,
        });
      }
    } else {
      resolvedFilters.push(f);
    }
  }

  // Fuzzy-match sort column
  let resolvedSort = sortCol ? { column: sortCol, direction: sortDir } : undefined;
  if (sortCol && availableColumns.length && !availableColumns.includes(sortCol)) {
    const match = findClosestColumn(sortCol, availableColumns);
    if (match) resolvedSort = { column: match, direction: sortDir };
  }

  // Try Tabular API
  try {
    const data = await queryResourceData(
      rid, page, pageSize,
      resolvedFilters.length ? resolvedFilters : undefined,
      resolvedSort,
    );

    return JSON.stringify({
      resource_id: rid,
      columns: schema?.columns?.map((c) => ({ name: c.name, type: c.type })) ?? [],
      totalColumns: schema?.totalColumns ?? data.columns.length,
      rows: data.rows,
      totalRows: data.totalRows ?? 0,
      page: data.page ?? page,
      hasMore: data.hasMore,
      filters: hasFilters ? resolvedFilters : null,
      corrections: corrections.length ? corrections : undefined,
    });
  } catch (tabErr) {
    // Tabular API failed — try download fallback (only for non-filtered requests)
    if (!hasFilters) {
      try {
        const info = await getResourceInfo(rid);
        const maxSize = 50 * 1024 * 1024;
        if (info.sizeBytes && info.sizeBytes > maxSize) {
          return JSON.stringify({
            resource_id: rid,
            error: `Fichier trop volumineux (${info.size}) pour l'exploration directe. Format: ${info.format}.`,
            columns: schema?.columns?.map((c) => ({ name: c.name, type: c.type })) ?? [],
            totalColumns: schema?.totalColumns ?? 0,
            rows: [],
            totalRows: 0,
          });
        }
        const parsed = await downloadAndParseResource(rid, 10);
        return JSON.stringify({
          resource_id: rid,
          columns: parsed.columns.map((c) => ({ name: c, type: "string" })),
          totalColumns: parsed.columns.length,
          rows: parsed.rows.slice(0, 10),
          totalRows: parsed.totalRows,
          source: "download",
        });
      } catch { /* download also failed */ }
    }

    // Return schema with error so the LLM can still reason about columns
    return JSON.stringify({
      resource_id: rid,
      error: tabErr instanceof Error ? tabErr.message : "Erreur d'accès aux données",
      columns: schema?.columns?.map((c) => ({ name: c.name, type: c.type })) ?? [],
      totalColumns: schema?.totalColumns ?? 0,
      rows: [],
      totalRows: 0,
      suggestion: availableColumns.length ? availableColumns.slice(0, 10) : undefined,
    });
  }
}

// ── search_and_preview: one-shot search + data lookup ────────

async function handleSearchAndPreview(args: ToolArgs): Promise<string> {
  const query = String(args.query || "");
  const dataQuery = args.data_query ? String(args.data_query) : null;
  const categories = args.category ? [String(args.category)] : undefined;
  const maxDatasets = Math.min(Number(args.max_datasets) || 3, 5);

  // Step 1: Search catalog
  const result = await searchEngine.search({
    keywords: query.split(/\s+/).filter(Boolean),
    categories,
    page: 1,
    pageSize: maxDatasets * 2, // fetch more to filter explorable ones
  });

  if (!result.items.length) {
    return JSON.stringify({ query, data_query: dataQuery, total: 0, datasets: [], message: "Aucun dataset trouvé" });
  }

  // Step 2: For each dataset, find explorable resources and optionally search within
  const TABULAR_API = "https://tabular-api.data.gouv.fr/api/";
  const TAB_FORMATS = new Set(["csv", "xls", "xlsx", "json", "tsv", "ods"]);

  interface DatasetPreview {
    id: string;
    title: string;
    organization: string;
    category: string;
    resource?: { id: string; title: string; format: string };
    columns?: Array<{ name: string; type: string }>;
    matchingRows?: Record<string, string>[];
    totalRows?: number;
    searchColumn?: string;
    error?: string;
  }

  const previews: DatasetPreview[] = [];
  let explored = 0;

  for (const item of result.items) {
    if (explored >= maxDatasets) break;

    try {
      // List resources and find tabular ones
      const resList = await Promise.race([
        listDatasetResources(item.id),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
      ]);

      const candidates = resList.resources.filter(
        (r) => TAB_FORMATS.has((r.format || "").toLowerCase()),
      );
      if (!candidates.length) continue;

      // Find first explorable resource
      let explorableResource: typeof candidates[0] | null = null;
      for (const r of candidates.slice(0, 3)) {
        try {
          const probe = await fetch(`${TABULAR_API}resources/${r.id}/profile/`, {
            signal: AbortSignal.timeout(3000),
          });
          if (probe.status === 200) { explorableResource = r; break; }
        } catch { /* next */ }
      }
      if (!explorableResource) continue;

      explored++;
      const preview: DatasetPreview = {
        id: item.id,
        title: item.title,
        organization: item.organization || "",
        category: item.categoryLabel || "",
        resource: { id: explorableResource.id, title: explorableResource.title, format: explorableResource.format },
      };

      // Get schema
      const schema = await getResourceSchema(explorableResource.id).catch(() => null);
      if (schema?.columns) {
        preview.columns = schema.columns.map((c) => ({ name: c.name, type: c.type }));
      }

      // If data_query provided, search within data
      if (dataQuery && schema?.columns) {
        // Find text-like columns to search in (string type, name-like)
        const textCols = schema.columns
          .filter((c) => c.type === "string" || c.type === "text" || c.type === "unknown")
          .map((c) => c.name);

        // Prioritize columns with "nom", "name", "libelle", "denomination", "titre" in name
        const namePatterns = /nom|name|libel|denom|titre|raison|label|desc/i;
        const priorityCols = textCols.filter((c) => namePatterns.test(c));
        const searchCols = priorityCols.length ? priorityCols : textCols.slice(0, 3);

        // Try each column until we find matches
        for (const col of searchCols) {
          try {
            const data = await queryResourceData(
              explorableResource.id, 1, 5,
              [{ column: col, value: dataQuery, operator: "contains" }],
            );
            if (data.rows?.length) {
              preview.matchingRows = data.rows.slice(0, 5);
              preview.totalRows = data.totalRows;
              preview.searchColumn = col;
              break;
            }
          } catch { /* try next column */ }
        }
      } else if (!dataQuery) {
        // No data_query — just get a preview of first rows
        try {
          const data = await queryResourceData(explorableResource.id, 1, 5);
          preview.matchingRows = data.rows?.slice(0, 5);
          preview.totalRows = data.totalRows;
        } catch { /* preview unavailable */ }
      }

      previews.push(preview);
    } catch { /* skip dataset */ }
  }

  return JSON.stringify({
    query,
    data_query: dataQuery,
    total: result.total,
    datasets: previews,
  });
}

// ── search_sirene: local SIRENE database search ─────────────

async function handleSearchSirene(args: ToolArgs): Promise<string> {
  if (!isSireneAvailable()) {
    return JSON.stringify({
      error: "Base SIRENE non disponible sur ce serveur",
      hint: "La base SIRENE n'a pas encore été importée. Utilisez search_and_preview pour chercher dans les datasets data.gouv.fr.",
    });
  }

  const query = String(args.query || "").trim();
  if (!query) return JSON.stringify({ error: "Paramètre query requis" });

  const limit = Math.min(Number(args.limit) || 10, 50);
  const filters: { etat_administratif?: string; activite_principale?: string } = {};
  if (args.statut) filters.etat_administratif = String(args.statut).toUpperCase();
  if (args.activite) filters.activite_principale = String(args.activite);

  const { total, results } = searchEntreprises(query, filters, limit);

  return JSON.stringify({
    query,
    total,
    results: results.map((r) => ({
      siren: r.siren,
      denomination: r.denomination,
      sigle: r.sigle,
      activite_principale: r.activite_principale,
      categorie_juridique: r.categorie_juridique,
      tranche_effectifs: r.tranche_effectifs,
      date_creation: r.date_creation,
      etat_administratif: r.etat_administratif,
      adresse: r.adresse,
      url: `/entreprise/${r.siren}`,
    })),
  });
}

// ── compare_data: parallel multi-source comparison ───────────

async function handleCompareData(args: ToolArgs): Promise<string> {
  const queries = Array.isArray(args.queries) ? args.queries as Array<{ label: string; search_query: string; data_query?: string }> : [];
  if (!queries.length) return JSON.stringify({ error: "Aucune requête de comparaison fournie" });
  if (queries.length > 4) return JSON.stringify({ error: "Maximum 4 comparaisons" });

  const TABULAR_API = "https://tabular-api.data.gouv.fr/api/";
  const TAB_FORMATS = new Set(["csv", "xls", "xlsx", "json", "tsv", "ods"]);

  interface ComparisonResult {
    label: string;
    query: string;
    dataset?: { id: string; title: string; organization: string };
    resource?: { id: string; title: string; format: string };
    columns?: Array<{ name: string; type: string }>;
    rows?: Record<string, string>[];
    totalRows?: number;
    searchColumn?: string;
    error?: string;
  }

  // Execute all comparisons in parallel
  const comparisons: ComparisonResult[] = await Promise.all(
    queries.map(async (q): Promise<ComparisonResult> => {
      const comp: ComparisonResult = { label: q.label, query: q.search_query };

      try {
        // Search
        const result = await searchEngine.search({
          keywords: q.search_query.split(/\s+/).filter(Boolean),
          page: 1,
          pageSize: 6,
        });

        if (!result.items.length) {
          comp.error = "Aucun dataset trouvé";
          return comp;
        }

        // Find first explorable dataset
        for (const item of result.items.slice(0, 4)) {
          try {
            const resList = await Promise.race([
              listDatasetResources(item.id),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
            ]);

            const candidates = resList.resources.filter(
              (r) => TAB_FORMATS.has((r.format || "").toLowerCase()),
            );

            for (const r of candidates.slice(0, 3)) {
              try {
                const probe = await fetch(`${TABULAR_API}resources/${r.id}/profile/`, { signal: AbortSignal.timeout(3000) });
                if (probe.status !== 200) continue;

                comp.dataset = { id: item.id, title: item.title, organization: item.organization || "" };
                comp.resource = { id: r.id, title: r.title, format: r.format };

                // Get schema + data
                const schema = await getResourceSchema(r.id).catch(() => null);
                if (schema?.columns) comp.columns = schema.columns.map((c) => ({ name: c.name, type: c.type }));

                if (q.data_query && schema?.columns) {
                  // Search in data
                  const namePatterns = /nom|name|libel|denom|titre|label|commune|ville/i;
                  const textCols = schema.columns.filter((c) => c.type === "string" || c.type === "text" || c.type === "unknown").map((c) => c.name);
                  const searchCols = textCols.filter((c) => namePatterns.test(c)).length ? textCols.filter((c) => namePatterns.test(c)) : textCols.slice(0, 2);

                  for (const col of searchCols) {
                    try {
                      const data = await queryResourceData(r.id, 1, 5, [{ column: col, value: q.data_query, operator: "contains" }]);
                      if (data.rows?.length) {
                        comp.rows = data.rows.slice(0, 5);
                        comp.totalRows = data.totalRows;
                        comp.searchColumn = col;
                        return comp;
                      }
                    } catch { /* next col */ }
                  }
                }

                // No data_query or no match — get preview
                const data = await queryResourceData(r.id, 1, 5).catch(() => null);
                if (data?.rows) {
                  comp.rows = data.rows.slice(0, 5);
                  comp.totalRows = data.totalRows;
                }
                return comp;
              } catch { /* next resource */ }
            }
          } catch { /* next item */ }
        }

        if (!comp.dataset) comp.error = "Aucune ressource exploitable trouvée";
      } catch (e) {
        comp.error = e instanceof Error ? e.message : "Erreur";
      }
      return comp;
    }),
  );

  return JSON.stringify({ comparisons });
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
