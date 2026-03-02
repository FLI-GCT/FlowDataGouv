/**
 * FlowDataGouv API client — accesses the intelligent search engine,
 * Mistral expansion, thematic analysis, and enriched catalog.
 */

import { config } from "./config.js";

const BASE = () => config.flowdataUrl;
const TIMEOUT = 30_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    // Try to extract error message from JSON response body
    let detail = res.statusText;
    try {
      const errBody = await res.json() as Record<string, unknown>;
      if (errBody.error) detail = String(errBody.error);
    } catch { /* ignore parse errors */ }
    throw new Error(`FlowData ${path}: ${res.status} — ${detail}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`FlowData ${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────

export interface SearchParams {
  query?: string;
  categories?: string[];
  subcategories?: string[];
  geoScopes?: string[];
  geoAreas?: string[];
  types?: string[];
  licenses?: string[];
  sort?: string;
  sortDir?: string;
  page?: number;
  pageSize?: number;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface SearchExpansion {
  original: string;
  corrected: string;
  keywords: string[];
  suggestedFilters?: {
    categories?: string[];
    geoScopes?: string[];
    geoAreas?: string[];
  };
  wasExpanded: boolean;
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

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: Record<string, FacetValue[]>;
  expansion?: SearchExpansion;
}

export interface SearchAnalysis {
  summary: string;
  groups: { label: string; description: string; datasetIds: string[] }[];
  insights: string[];
}

export interface CatalogSummary {
  lastSync: string;
  stats: { total: number; enriched: number; failed: number };
  categories: { slug: string; label: string; count: number; color: string }[];
  topDatasets: { id: string; title: string; organization: string; views: number; downloads: number }[];
  geoRegions: { name: string; count: number }[];
}

// ── API calls ────────────────────────────────────────────────────

/** Intelligent search: Mistral expansion + word-boundary scoring + facets */
export async function smartSearch(params: SearchParams): Promise<SearchResponse> {
  return post<SearchResponse>("/api/catalog/search", params);
}

/** Mistral query expansion (typo correction + keyword generation + filter suggestions) */
export async function expandQuery(query: string): Promise<SearchExpansion> {
  const res = await post<{ expansion: SearchExpansion }>("/api/search/expand", { query });
  return res.expansion ?? { original: query, corrected: query, keywords: [query], wasExpanded: false };
}

/** Mistral thematic analysis of search results */
export async function analyzeResults(
  query: string,
  datasets: { id: string; title: string; organization?: string; tags: string[]; category?: string; geoScope?: string }[]
): Promise<SearchAnalysis> {
  return post<SearchAnalysis>("/api/search/analyze", { query, datasets });
}

/** Lightweight catalog summary (stats, categories, top datasets, geo regions) */
export async function getCatalogSummary(): Promise<CatalogSummary> {
  return get<CatalogSummary>("/api/catalog/summary");
}

/** Health check */
export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  return get<{ status: string; timestamp: string }>("/api/health");
}

/** Proxy data.gouv.fr API call */
export async function proxyDatagouvCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await post<{ result: unknown }>("/api/datagouv/call", { tool, args });
  return res.result;
}

/** Proxy external API call (for Try It on dataservices) */
export async function proxyApiCall(params: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; statusText: string; body: unknown; duration: number }> {
  return post("/api/dataservice/proxy", params);
}
