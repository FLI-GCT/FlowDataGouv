/**
 * Direct data.gouv.fr REST client — fallback when FlowDataGouv is unavailable.
 * Provides raw dataset/resource/API access without Mistral intelligence.
 */

import { config } from "./config.js";

const API = () => config.datagouvApiUrl;
const TABULAR = () => config.tabularApiUrl;
const TIMEOUT = 15_000;

async function get<T>(url: string, timeout = TIMEOUT): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`data.gouv.fr: ${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

// ── Datasets ─────────────────────────────────────────────────────

export async function searchDatasets(query: string, page = 1, pageSize = 20) {
  const url = `${API()}/datasets/?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`;
  const data = await get<{ total: number; data: unknown[] }>(url);
  return { total: data.total, datasets: data.data.map(mapDataset) };
}

export async function getDatasetInfo(id: string) {
  return get<Record<string, unknown>>(`${API()}/datasets/${id}/`);
}

export async function listDatasetResources(id: string) {
  const ds = await get<{ resources: unknown[] }>(`${API()}/datasets/${id}/`);
  return (ds.resources || []).map(mapResource);
}

export async function getResourceInfo(resourceId: string) {
  return get<Record<string, unknown>>(`${API()}/datasets/resources/${resourceId}/`);
}

// ── Tabular data ─────────────────────────────────────────────────

export async function queryResourceData(resourceId: string, page = 1, pageSize = 20) {
  const url = `${TABULAR()}/resources/${resourceId}/data/?page=${page}&page_size=${pageSize}`;
  return get<Record<string, unknown>>(url, 30_000);
}

// ── APIs / Dataservices ──────────────────────────────────────────

export async function searchDataservices(query: string, page = 1, pageSize = 20) {
  const url = `${API()}/dataservices/?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`;
  const data = await get<{ total: number; data: unknown[] }>(url);
  return { total: data.total, dataservices: data.data };
}

export async function getDataserviceInfo(id: string) {
  return get<Record<string, unknown>>(`${API()}/dataservices/${id}/`);
}

// ── Metrics ──────────────────────────────────────────────────────

export async function getMetrics(datasetId: string) {
  const url = `${API()}/datasets/${datasetId}/`;
  const ds = await get<Record<string, unknown>>(url);
  return { views: ds.metrics, id: datasetId };
}

// ── Latest ───────────────────────────────────────────────────────

export async function getLatestDatasets(pageSize = 10) {
  const url = `${API()}/datasets/?sort=-last_modified&page_size=${pageSize}`;
  const data = await get<{ total: number; data: unknown[] }>(url);
  return { total: data.total, datasets: data.data.map(mapDataset) };
}

export async function getLatestDataservices(pageSize = 10) {
  const url = `${API()}/dataservices/?sort=-created_at&page_size=${pageSize}`;
  const data = await get<{ total: number; data: unknown[] }>(url);
  return { total: data.total, dataservices: data.data };
}

// ── Mappers ──────────────────────────────────────────────────────

function mapDataset(d: unknown): Record<string, unknown> {
  const ds = d as Record<string, unknown>;
  const org = ds.organization as Record<string, string> | null;
  return {
    id: ds.id,
    title: ds.title,
    slug: ds.slug,
    description: typeof ds.description === "string" ? ds.description.slice(0, 300) : "",
    organization: org?.name || "Inconnu",
    tags: Array.isArray(ds.tags) ? ds.tags : [],
    resourceCount: Array.isArray(ds.resources) ? ds.resources.length : 0,
    lastModified: ds.last_modified,
    license: ds.license,
  };
}

function mapResource(r: unknown): Record<string, unknown> {
  const res = r as Record<string, unknown>;
  return {
    id: res.id,
    title: res.title,
    format: res.format,
    filesize: res.filesize,
    mime: res.mime,
    url: res.url,
    type: res.type,
  };
}
