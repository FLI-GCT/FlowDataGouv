/**
 * In-memory search engine over store.json (73k+ enriched items).
 * Provides full-text search with word-boundary scoring + faceted filtering + sorting + pagination.
 *
 * Key features:
 * - Word-boundary matching (prevents "yonne" matching "bayonne")
 * - Dynamic subcategory + geoArea facets
 * - Cross-facet counts (each facet excludes its own filter)
 */

import * as fs from "fs/promises";
import * as path from "path";

// ── Types ────────────────────────────────────────────────────────

export interface SearchableItem {
  id: string;
  title: string;
  titleLower: string;
  org: string;
  orgLower: string;
  type: "dataset" | "dataservice";
  tags: string[];
  tagsJoined: string;
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
  geoAreaLower: string;
  summary: string;
  summaryLower: string;
  themes: string[];
  themesJoined: string;
  quality: number;
  descLower: string;
  hasHvd: boolean;
}

export interface SearchParams {
  keywords?: string[];
  categories?: string[];
  subcategories?: string[];
  geoScopes?: string[];
  geoAreas?: string[];
  types?: ("dataset" | "dataservice")[];
  licenses?: string[];
  /** ISO date string — only keep items modified on or after this date */
  dateAfter?: string;
  /** Minimum quality score (1-5) */
  qualityMin?: number;
  sort?: "relevance" | "views" | "downloads" | "lastModified" | "quality";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface FacetCounts {
  categories: FacetValue[];
  subcategories: FacetValue[];
  geoScopes: FacetValue[];
  geoAreas: FacetValue[];
  types: FacetValue[];
  licenses: FacetValue[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  organization: string;
  type: "dataset" | "dataservice";
  summary: string;
  category: string;
  categoryLabel: string;
  subcategory: string;
  geoScope: string;
  geoArea: string;
  tags: string[];
  views: number;
  downloads: number;
  reuses: number;
  lastModified: string;
  license: string;
  quality: number;
  score?: number;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: FacetCounts;
}

// ── Category labels ──────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
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

// ── Word-boundary matching ───────────────────────────────────────

/** French stop words to ignore during tokenization */
const STOP_WORDS = new Set([
  // Determiners & pronouns
  "le", "la", "les", "de", "du", "des", "un", "une", "et", "ou", "en",
  "au", "aux", "ce", "se", "sur", "par", "pour", "dans", "avec", "est",
  "son", "sa", "ses", "que", "qui", "tout", "tous", "toute", "toutes",
  "mon", "ma", "mes", "ton", "ta", "tes", "je", "tu", "il", "elle", "on",
  "nous", "vous", "ils", "elles", "ne", "pas", "plus", "tres", "bien",
  // English
  "the", "and", "for", "from", "this", "that", "with",
  // Search-specific generic terms
  "trouve", "trouver", "cherche", "chercher", "donnees", "donnee",
  "data", "dataset", "fichier", "csv", "json", "api", "information",
  // Administrative/geographic generic terms (too broad for scoring)
  "ville", "commune", "region", "departement", "pays", "territoire",
  "agglomeration", "metropole", "canton", "prefecture", "arrondissement",
  "france", "francais", "francaise", "national", "local",
]);

/**
 * Create a word-boundary matcher for a keyword.
 * Prevents "yonne" matching "bayonne" — uses \b regex.
 * Pre-compiled per keyword for performance.
 */
function createWordMatcher(keyword: string): (text: string) => boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return () => false;
  try {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return (text: string) => regex.test(text);
  } catch {
    return (text: string) => text.includes(kw);
  }
}

/**
 * Normalize keywords: split multi-word phrases into individual meaningful tokens.
 * "Tout sur l'Yonne ou sur Dijon" → ["yonne", "dijon"]
 * Short single-word keywords pass through as-is.
 */
function normalizeKeywords(keywords: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;

    // Single word or short compound (2 words) → keep as-is, no decomposition
    // Keeping 2-word compounds intact prevents false positives
    // (e.g. "identifiant entreprise" won't match "entreprise" alone)
    const words = trimmed.split(/[\s'',;:!?]+/).filter(Boolean);
    if (words.length <= 2) {
      const lower = trimmed.toLowerCase();
      if (!STOP_WORDS.has(lower) && lower.length >= 2 && !seen.has(lower)) {
        seen.add(lower);
        result.push(trimmed);
      }
      continue;
    }

    // Multi-word phrase → extract meaningful tokens
    for (const w of words) {
      const wl = w.toLowerCase();
      if (!STOP_WORDS.has(wl) && wl.length >= 2 && !seen.has(wl)) {
        seen.add(wl);
        result.push(w);
      }
    }
  }

  return result;
}

// ── Store types (compact keys) ───────────────────────────────────

interface StoredEnrichment {
  cat: string;
  sub: string;
  sub2?: string;
  geo: string;
  area?: string;
  sum: string;
  th: string[];
  q: number;
  at: string;
}

interface StoredDataset {
  id: string;
  title: string;
  org: string;
  type: "d" | "a";
  tags: string[];
  v: number;
  dl: number;
  r: number;
  f: number;
  lic?: string;
  freq?: string;
  mod?: string;
  url?: string;
  desc?: string;
  e?: StoredEnrichment;
  ef?: number;
}

interface Store {
  v: number;
  fetchedAt?: string;
  ds: Record<string, StoredDataset>;
}

// ── Scoring constants (v2: per-field with breadth bonus) ────────

const SCORE_FIELDS: { key: keyof SearchableItem; weight: number; label: string; guard?: boolean }[] = [
  { key: "titleLower",   weight: 10, label: "title" },
  { key: "orgLower",     weight: 5,  label: "org" },
  { key: "tagsJoined",   weight: 4,  label: "tags" },
  { key: "themesJoined", weight: 3,  label: "themes" },
  { key: "summaryLower", weight: 3,  label: "summary" },
  { key: "geoAreaLower", weight: 2,  label: "geo", guard: true },
  { key: "descLower",    weight: 1,  label: "desc" },
];
const BREADTH_BONUS = 0.15;  // +15% per extra keyword matching same field
const BREADTH_CAP = 2;       // max 2 extra keywords counted
// Keyword weight decay: first keyword (main intent) has full weight,
// subsequent keywords (synonyms/qualifiers) contribute less
const KW_WEIGHTS = [1.0, 0.6, 0.4, 0.3, 0.3];

// ── Result cache ────────────────────────────────────────────────

const RESULT_CACHE_TTL = 5 * 60_000; // 5 minutes
const RESULT_CACHE_MAX = 200;

interface CachedResult { result: SearchResult; timestamp: number }
const resultCache = new Map<string, CachedResult>();

function resultCacheKey(params: SearchParams): string {
  return JSON.stringify([
    params.keywords, params.categories, params.subcategories,
    params.geoScopes, params.geoAreas, params.types, params.licenses,
    params.dateAfter, params.qualityMin, params.sort, params.sortDir,
    params.page, params.pageSize,
  ]);
}

// ── Search Engine ────────────────────────────────────────────────

const STORE_PATH = () => path.join(process.cwd(), "data", "store.json");

class CatalogSearchEngine {
  private items: SearchableItem[] = [];
  private storeMtime: number = 0;
  private loading: Promise<void> | null = null;

  /** Load store.json and build searchable index */
  async load(): Promise<void> {
    const storePath = STORE_PATH();
    let raw: string;
    try {
      raw = await fs.readFile(storePath, "utf-8");
    } catch {
      console.warn("[search-engine] store.json not found");
      this.items = [];
      return;
    }

    const store: Store = JSON.parse(raw);
    const stat = await fs.stat(storePath);
    this.storeMtime = stat.mtimeMs;

    const items: SearchableItem[] = [];
    for (const ds of Object.values(store.ds)) {
      const e = ds.e;
      const cat = e?.cat || "";
      const item: SearchableItem = {
        id: ds.id,
        title: ds.title,
        titleLower: ds.title.toLowerCase(),
        org: ds.org,
        orgLower: ds.org.toLowerCase(),
        type: ds.type === "a" ? "dataservice" : "dataset",
        tags: ds.tags || [],
        tagsJoined: (ds.tags || []).join(" ").toLowerCase(),
        views: ds.v || 0,
        downloads: ds.dl || 0,
        reuses: ds.r || 0,
        lastModified: ds.mod || "",
        license: ds.lic || "notspecified",
        frequency: ds.freq || "",
        category: cat,
        categoryLabel: CATEGORY_LABELS[cat] || cat,
        subcategory: e?.sub || "",
        sub2: e?.sub2 || "",
        geoScope: e?.geo || "",
        geoArea: e?.area || "",
        geoAreaLower: (e?.area || "").toLowerCase(),
        summary: e?.sum || "",
        summaryLower: (e?.sum || "").toLowerCase(),
        themes: e?.th || [],
        themesJoined: (e?.th || []).join(" ").toLowerCase(),
        quality: e?.q || 0,
        descLower: (ds.desc || "").toLowerCase(),
        hasHvd: (ds.tags || []).includes("hvd"),
      };
      items.push(item);
    }

    this.items = items;
    console.log(`[search-engine] Indexed ${items.length} items`);
  }

  /** Ensure index is fresh (reload if store.json changed) */
  async ensureFresh(): Promise<void> {
    if (this.loading) {
      await this.loading;
      return;
    }

    if (this.items.length === 0) {
      this.loading = this.load();
      await this.loading;
      this.loading = null;
      return;
    }

    try {
      const stat = await fs.stat(STORE_PATH());
      if (stat.mtimeMs !== this.storeMtime) {
        console.log("[search-engine] store.json changed, reloading...");
        resultCache.clear();
        this.loading = this.load();
        await this.loading;
        this.loading = null;
      }
    } catch {
      // store.json missing, keep current index
    }
  }

  /** Main search function */
  async search(params: SearchParams): Promise<SearchResult> {
    await this.ensureFresh();

    const cKey = resultCacheKey(params);
    const cached = resultCache.get(cKey);
    if (cached && Date.now() - cached.timestamp < RESULT_CACHE_TTL) {
      return cached.result;
    }

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const hasTextSearch = params.keywords && params.keywords.length > 0;

    // Normalize & pre-compile word matchers for text search (with weight decay)
    let matchers: { kw: string; kwWeight: number; match: (text: string) => boolean }[] = [];
    if (hasTextSearch) {
      const normalized = normalizeKeywords(params.keywords!);
      matchers = normalized.map((k, i) => ({
        kw: k.toLowerCase(),
        kwWeight: KW_WEIGHTS[Math.min(i, KW_WEIGHTS.length - 1)],
        match: createWordMatcher(k),
      }));
    }

    // Score all items if text search
    let scored: { item: SearchableItem; score: number }[];
    if (hasTextSearch) {
      scored = [];
      for (const item of this.items) {
        const score = this.scoreItem(item, matchers);
        if (score > 0) scored.push({ item, score });
      }
    } else {
      scored = this.items.map((item) => ({ item, score: 0 }));
    }

    // Debug: log top 10 scored items with per-field breakdown
    if (hasTextSearch && scored.length > 0) {
      const top10 = [...scored].sort((a, b) => b.score - a.score).slice(0, 10);
      const matcherNames = matchers.map(m => `${m.kw}(${m.kwWeight})`).join(", ");
      const lines = top10.map((s, i) => {
        const bd: string[] = [];
        for (const { key, weight, label, guard } of SCORE_FIELDS) {
          if (guard && !s.item[key]) continue;
          const text = s.item[key] as string;
          let mc = 0;
          let bestW = 0;
          for (const { kwWeight, match } of matchers) { if (match(text)) { mc++; if (kwWeight > bestW) bestW = kwWeight; } }
          if (mc > 0) {
            const pts = weight * bestW + Math.min(mc - 1, BREADTH_CAP) * weight * BREADTH_BONUS;
            bd.push(`${label}=${pts.toFixed(1)}`);
          }
        }
        const pop = Math.log10(1 + s.item.views + s.item.downloads) * 2.5;
        bd.push(`pop=${pop.toFixed(1)}`);
        bd.push(`q=${s.item.quality}`);
        if (s.item.hasHvd) bd.push("hvd=3");
        return `  #${i + 1} [${s.score.toFixed(1)}] "${s.item.title.slice(0, 55)}" ${bd.join(" ")} | ${s.item.views}v`;
      });
      console.error(`[search/score] matchers=[${matcherNames}]\n${lines.join("\n")}`);
    }

    // Apply facet filters
    const filtered = scored.filter(({ item }) => {
      if (params.categories?.length && !params.categories.includes(item.category)) return false;
      if (params.subcategories?.length && !params.subcategories.includes(item.subcategory)) return false;
      if (params.geoScopes?.length && !params.geoScopes.includes(item.geoScope)) return false;
      if (params.geoAreas?.length) {
        const itemArea = item.geoAreaLower;
        if (!params.geoAreas.some((a) => a.toLowerCase() === itemArea)) return false;
      }
      if (params.types?.length && !params.types.includes(item.type)) return false;
      if (params.licenses?.length && !params.licenses.includes(item.license)) return false;
      if (params.dateAfter && item.lastModified < params.dateAfter) return false;
      if (params.qualityMin && item.quality < params.qualityMin) return false;
      return true;
    });

    // Compute facets
    const facets = this.computeFacets(scored, params);

    // Sort
    const sort = params.sort || (hasTextSearch ? "relevance" : "downloads");
    const dir = params.sortDir || "desc";
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "relevance": cmp = a.score - b.score; break;
        case "views": cmp = a.item.views - b.item.views; break;
        case "downloads": cmp = a.item.downloads - b.item.downloads; break;
        case "lastModified": cmp = a.item.lastModified.localeCompare(b.item.lastModified); break;
        case "quality": cmp = a.item.quality - b.item.quality; break;
      }
      return dir === "asc" ? cmp : -cmp;
    });

    // Paginate
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    const items: SearchResultItem[] = paged.map(({ item, score }) => ({
      id: item.id,
      title: item.title,
      organization: item.org,
      type: item.type,
      summary: item.summary,
      category: item.category,
      categoryLabel: item.categoryLabel,
      subcategory: item.subcategory,
      geoScope: item.geoScope,
      geoArea: item.geoArea,
      tags: item.tags.slice(0, 5),
      views: item.views,
      downloads: item.downloads,
      reuses: item.reuses,
      lastModified: item.lastModified,
      license: item.license,
      quality: item.quality,
      ...(hasTextSearch ? { score } : {}),
    }));

    const result: SearchResult = { items, total, page, pageSize, facets };
    if (resultCache.size >= RESULT_CACHE_MAX) {
      resultCache.delete(resultCache.keys().next().value!);
    }
    resultCache.set(cKey, { result, timestamp: Date.now() });
    return result;
  }

  /**
   * Score an item against keywords (v2: per-field with breadth bonus).
   * Each field scores once (base weight), with a small capped bonus for
   * additional keyword matches. Prevents synonym expansion from inflating
   * scores for long titles over short authoritative ones.
   */
  private scoreItem(
    item: SearchableItem,
    matchers: { kw: string; kwWeight: number; match: (text: string) => boolean }[]
  ): number {
    let score = 0;
    for (const { key, weight, guard } of SCORE_FIELDS) {
      if (guard && !item[key]) continue;
      const text = item[key] as string;
      let matchCount = 0;
      let bestKwWeight = 0;
      for (const { kwWeight, match } of matchers) {
        if (match(text)) {
          matchCount++;
          if (kwWeight > bestKwWeight) bestKwWeight = kwWeight;
        }
      }
      if (matchCount > 0) {
        score += weight * bestKwWeight;
        score += Math.min(matchCount - 1, BREADTH_CAP) * weight * BREADTH_BONUS;
      }
    }
    if (score > 0) {
      score += Math.log10(1 + item.views + item.downloads) * 2.5;
      score += item.quality * 1.0;
      if (item.hasHvd) score += 3;
    }
    return score;
  }

  /** Compute facet counts — each facet excludes its own active filter */
  private computeFacets(
    scored: { item: SearchableItem; score: number }[],
    params: SearchParams
  ): FacetCounts {
    const catCounts = new Map<string, number>();
    const subCounts = new Map<string, number>();
    const geoCounts = new Map<string, number>();
    const areaCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const licCounts = new Map<string, number>();

    // Global filters (date + quality apply to all facets)
    const passDate = (item: SearchableItem) => !params.dateAfter || item.lastModified >= params.dateAfter;
    const passQuality = (item: SearchableItem) => !params.qualityMin || item.quality >= params.qualityMin;

    for (const { item } of scored) {
      if (!passDate(item) || !passQuality(item)) continue;

      const passCat = !params.categories?.length || params.categories.includes(item.category);
      const passSub = !params.subcategories?.length || params.subcategories.includes(item.subcategory);
      const passGeo = !params.geoScopes?.length || params.geoScopes.includes(item.geoScope);
      const passArea = !params.geoAreas?.length || params.geoAreas.some((a) => a.toLowerCase() === item.geoAreaLower);
      const passType = !params.types?.length || params.types.includes(item.type);
      const passLic = !params.licenses?.length || params.licenses.includes(item.license);

      // Category: all except category + subcategory
      if (passGeo && passArea && passType && passLic && item.category) {
        catCounts.set(item.category, (catCounts.get(item.category) || 0) + 1);
      }

      // Subcategory: all except subcategory (include category filter to make it dynamic)
      if (passCat && passGeo && passArea && passType && passLic && item.subcategory) {
        subCounts.set(item.subcategory, (subCounts.get(item.subcategory) || 0) + 1);
      }

      // GeoScope: all except geoScope + geoArea
      if (passCat && passSub && passType && passLic && item.geoScope) {
        geoCounts.set(item.geoScope, (geoCounts.get(item.geoScope) || 0) + 1);
      }

      // GeoArea: all except geoArea (include geoScope filter to make it dynamic)
      if (passCat && passSub && passGeo && passType && passLic && item.geoArea) {
        areaCounts.set(item.geoArea, (areaCounts.get(item.geoArea) || 0) + 1);
      }

      // Type: all except type
      if (passCat && passSub && passGeo && passArea && passLic) {
        typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
      }

      // License: all except license
      if (passCat && passSub && passGeo && passArea && passType && item.license) {
        licCounts.set(item.license, (licCounts.get(item.license) || 0) + 1);
      }
    }

    const toFacetValues = (
      counts: Map<string, number>,
      labels: Record<string, string>,
      max?: number,
    ): FacetValue[] => {
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const sliced = max ? sorted.slice(0, max) : sorted;
      return sliced.map(([value, count]) => ({
        value,
        label: labels[value] || value,
        count,
      }));
    };

    return {
      categories: toFacetValues(catCounts, CATEGORY_LABELS),
      subcategories: toFacetValues(subCounts, {}, 20),
      geoScopes: toFacetValues(geoCounts, GEO_LABELS),
      geoAreas: toFacetValues(areaCounts, {}, 20),
      types: toFacetValues(typeCounts, { dataset: "Datasets", dataservice: "APIs" }),
      licenses: toFacetValues(licCounts, LICENSE_LABELS),
    };
  }
}

/** Singleton instance */
export const searchEngine = new CatalogSearchEngine();
