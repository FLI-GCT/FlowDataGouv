/**
 * MeiliSearch client for FlowDataGouv.
 * Wraps the meilisearch SDK with typed search, facets, and index configuration.
 */

import { MeiliSearch, type SearchResponse, type SearchParams as MeiliSearchParams } from "meilisearch";

// ── Types ────────────────────────────────────────────────────────

export interface MeiliDocument {
  id: string;
  title: string;
  org: string;
  type: "dataset" | "dataservice";
  tags: string[];
  views: number;
  downloads: number;
  reuses: number;
  lastModified: string;
  license: string;
  frequency: string;
  category: string;
  categoryLabel: string;
  subcategory: string;
  sub2: string;
  geoScope: string;
  geoArea: string;
  summary: string;
  themes: string[];
  quality: number;
  description: string;
  hasHvd: boolean;
  /** Combined popularity for custom ranking */
  _popularity: number;
}

// Re-export search types from the existing engine for compatibility
import type {
  SearchParams,
  SearchResult,
  SearchResultItem,
  FacetValue,
  FacetCounts,
} from "./search-engine";

export type { SearchParams, SearchResult, SearchResultItem, FacetValue, FacetCounts };

// ── Constants ────────────────────────────────────────────────────

const INDEX_NAME = "datasets";

const MEILI_URL = process.env.MEILI_URL || "http://127.0.0.1:7700";
const MEILI_KEY = process.env.MEILI_MASTER_KEY || process.env.MEILI_API_KEY || "dev-master-key-for-local";

// ── Category / geo / license labels (shared with search-engine.ts) ──

export const CATEGORY_LABELS: Record<string, string> = {
  "environnement": "Environnement & Ecologie",
  "transport-mobilite": "Transport & Mobilite",
  "sante": "Sante",
  "education-recherche": "Education & Recherche",
  "economie-emploi": "Economie & Emploi",
  "logement-urbanisme": "Logement & Urbanisme",
  "agriculture-alimentation": "Agriculture & Alimentation",
  "culture-patrimoine": "Culture & Patrimoine",
  "justice-securite": "Justice & Securite",
  "collectivites-administration": "Collectivites & Administration",
  "finances-fiscalite": "Finances & Fiscalite",
  "geographie-cartographie": "Geographie & Cartographie",
  "energie": "Energie",
  "social-solidarite": "Social & Solidarite",
  "tourisme-loisirs-sport": "Tourisme, Loisirs & Sport",
  "numerique-technologie": "Numerique & Technologie",
  "elections-democratie": "Elections & Democratie",
  "divers": "Divers",
};

const GEO_LABELS: Record<string, string> = {
  "national": "National",
  "regional": "Regional",
  "departemental": "Departemental",
  "communal": "Communal",
};

const LICENSE_LABELS: Record<string, string> = {
  "lov2": "Licence Ouverte v2",
  "notspecified": "Non specifiee",
  "fr-lo": "Licence Ouverte v1",
  "odc-odbl": "ODbL",
  "other-at": "Autre (attribution)",
  "other-pd": "Domaine public",
  "cc-by": "CC-BY",
  "other-open": "Autre licence ouverte",
  "cc-by-sa": "CC-BY-SA",
  "odc-by": "ODC-BY",
};

// ── Synonyms (French domain-specific) ────────────────────────────

const SYNONYMS: Record<string, string[]> = {
  "emploi": ["travail", "recrutement", "offre emploi"],
  "travail": ["emploi", "recrutement"],
  "transport": ["mobilite", "deplacement", "circulation"],
  "mobilite": ["transport", "deplacement"],
  "immobilier": ["logement", "habitation", "foncier"],
  "logement": ["immobilier", "habitation", "hlm"],
  "sante": ["medical", "hopital", "hospitalier"],
  "ecole": ["education", "enseignement", "scolaire", "etablissement scolaire"],
  "education": ["ecole", "enseignement", "scolaire"],
  "environnement": ["ecologie", "biodiversite", "nature"],
  "eau": ["hydrologie", "riviere", "fleuve", "cours eau"],
  "air": ["pollution", "qualite air", "atmosphere"],
  "election": ["vote", "scrutin", "electoral", "resultat electoral"],
  "budget": ["finances", "fiscal", "depenses", "recettes"],
  "entreprise": ["societe", "etablissement", "sirene", "siren"],
  "carte": ["cartographie", "geographie", "sig"],
  "population": ["demographie", "recensement", "habitants"],
  "crime": ["delinquance", "securite", "infraction"],
  "agriculture": ["agricole", "exploitation", "culture", "elevage"],
  "energie": ["electricite", "gaz", "consommation energetique"],
};

// ── Client ───────────────────────────────────────────────────────

let client: MeiliSearch | null = null;
let indexReady = false;

function getClient(): MeiliSearch {
  if (!client) {
    client = new MeiliSearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  }
  return client;
}

/** Check if MeiliSearch is reachable */
export async function isHealthy(): Promise<boolean> {
  try {
    const c = getClient();
    const health = await c.health();
    return health.status === "available";
  } catch {
    return false;
  }
}

/** Configure the index settings (idempotent) */
export async function configureIndex(): Promise<void> {
  const c = getClient();
  const index = c.index(INDEX_NAME);

  const settingsTask = await index.updateSettings({
    searchableAttributes: [
      "title",
      "org",
      "tags",
      "themes",
      "summary",
      "geoArea",
      "description",
    ],
    filterableAttributes: [
      "category", "subcategory", "geoScope", "geoArea",
      "type", "license", "lastModified", "quality", "hasHvd",
    ],
    sortableAttributes: [
      "views", "downloads", "quality", "lastModified", "_popularity",
    ],
    faceting: { maxValuesPerFacet: 100 },
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    },
    synonyms: SYNONYMS,
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
    pagination: { maxTotalHits: 10000 },
  });

  // Wait for settings task to complete
  await c.tasks.waitForTask(settingsTask.taskUid, { timeout: 30_000 });

  indexReady = true;
  console.log("[meili] Index configured");
}

/** Index documents (batched) */
export async function indexDocuments(docs: MeiliDocument[]): Promise<void> {
  const c = getClient();
  const index = c.index(INDEX_NAME);
  const BATCH = 1000;

  let lastTaskUid: number | undefined;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const task = await index.addDocuments(batch, { primaryKey: "id" });
    lastTaskUid = task.taskUid;
  }

  // Wait for the last batch to complete
  if (lastTaskUid !== undefined) {
    await c.tasks.waitForTask(lastTaskUid, { timeout: 120_000 });
  }

  console.log(`[meili] Indexed ${docs.length} documents`);
}

/** Get the number of documents in the index */
export async function getDocumentCount(): Promise<number> {
  try {
    const c = getClient();
    const index = c.index(INDEX_NAME);
    const stats = await index.getStats();
    return stats.numberOfDocuments;
  } catch {
    return 0;
  }
}

// ── Search ───────────────────────────────────────────────────────

/**
 * Search via MeiliSearch — returns the same SearchResult format
 * as the old in-memory engine for zero breaking changes.
 */
export async function search(params: SearchParams): Promise<SearchResult> {
  const c = getClient();
  const index = c.index(INDEX_NAME);

  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const hasTextSearch = params.keywords && params.keywords.length > 0;
  const query = hasTextSearch ? params.keywords!.join(" ") : "";

  // Build filter string
  const filters = buildFilterString(params);

  // Build sort
  const sort = buildSort(params, !!hasTextSearch);

  // Facets — request all 6 facet types
  const facetNames = ["category", "subcategory", "geoScope", "geoArea", "type", "license"];

  const searchParams: MeiliSearchParams = {
    offset: (page - 1) * pageSize,
    limit: pageSize,
    filter: filters.length > 0 ? filters : undefined,
    sort: sort.length > 0 ? sort : undefined,
    facets: facetNames,
    attributesToRetrieve: [
      "id", "title", "org", "type", "summary", "category", "categoryLabel",
      "subcategory", "geoScope", "geoArea", "tags", "views", "downloads",
      "reuses", "lastModified", "license", "quality",
    ],
    showRankingScore: hasTextSearch,
  };

  const response: SearchResponse<MeiliDocument> = await index.search(query, searchParams);

  // Map hits to SearchResultItem
  const items: SearchResultItem[] = response.hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    organization: hit.org,
    type: hit.type,
    summary: hit.summary || "",
    category: hit.category || "",
    categoryLabel: hit.categoryLabel || "",
    subcategory: hit.subcategory || "",
    geoScope: hit.geoScope || "",
    geoArea: hit.geoArea || "",
    tags: (hit.tags || []).slice(0, 5),
    views: hit.views || 0,
    downloads: hit.downloads || 0,
    reuses: hit.reuses || 0,
    lastModified: hit.lastModified || "",
    license: hit.license || "",
    quality: hit.quality || 0,
    ...(hasTextSearch && hit._rankingScore != null ? { score: hit._rankingScore } : {}),
  }));

  // Build facets from MeiliSearch facet distribution
  const facets = buildFacetCounts(response.facetDistribution || {});

  const total = response.estimatedTotalHits ?? response.totalHits ?? 0;

  return { items, total, page, pageSize, facets };
}

// ── Filter builder ───────────────────────────────────────────────

function buildFilterString(params: SearchParams): string[] {
  const parts: string[] = [];

  if (params.categories?.length) {
    parts.push(`category IN [${params.categories.map(v => `"${v}"`).join(", ")}]`);
  }
  if (params.subcategories?.length) {
    parts.push(`subcategory IN [${params.subcategories.map(v => `"${v}"`).join(", ")}]`);
  }
  if (params.geoScopes?.length) {
    parts.push(`geoScope IN [${params.geoScopes.map(v => `"${v}"`).join(", ")}]`);
  }
  if (params.geoAreas?.length) {
    parts.push(`geoArea IN [${params.geoAreas.map(v => `"${v}"`).join(", ")}]`);
  }
  if (params.types?.length) {
    parts.push(`type IN [${params.types.map(v => `"${v}"`).join(", ")}]`);
  }
  if (params.licenses?.length) {
    parts.push(`license IN [${params.licenses.map(v => `"${v}"`).join(", ")}]`);
  }
  if (params.dateAfter) {
    parts.push(`lastModified >= "${params.dateAfter}"`);
  }
  if (params.qualityMin) {
    parts.push(`quality >= ${params.qualityMin}`);
  }

  return parts;
}

// ── Sort builder ─────────────────────────────────────────────────

function buildSort(params: SearchParams, hasTextSearch: boolean): string[] {
  const sort = params.sort || (hasTextSearch ? "relevance" : "downloads");
  const dir = params.sortDir || "desc";

  // relevance = MeiliSearch's default ranking, no explicit sort needed
  if (sort === "relevance") return [];

  const meiliDir = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "views": return [`views:${meiliDir}`];
    case "downloads": return [`downloads:${meiliDir}`];
    case "lastModified": return [`lastModified:${meiliDir}`];
    case "quality": return [`quality:${meiliDir}`];
    default: return [];
  }
}

// ── Facet builder ────────────────────────────────────────────────

function buildFacetCounts(dist: Record<string, Record<string, number>>): FacetCounts {
  const toFacetValues = (
    raw: Record<string, number> | undefined,
    labels: Record<string, string>,
    max?: number,
  ): FacetValue[] => {
    if (!raw) return [];
    const entries = Object.entries(raw).sort((a, b) => b[1] - a[1]);
    const sliced = max ? entries.slice(0, max) : entries;
    return sliced.map(([value, count]) => ({
      value,
      label: labels[value] || value,
      count,
    }));
  };

  return {
    categories: toFacetValues(dist.category, CATEGORY_LABELS),
    subcategories: toFacetValues(dist.subcategory, {}, 20),
    geoScopes: toFacetValues(dist.geoScope, GEO_LABELS),
    geoAreas: toFacetValues(dist.geoArea, {}, 20),
    types: toFacetValues(dist.type, { dataset: "Datasets", dataservice: "APIs" }),
    licenses: toFacetValues(dist.license, LICENSE_LABELS),
  };
}

export { indexReady, INDEX_NAME };
