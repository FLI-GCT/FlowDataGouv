/**
 * Direct REST client for data.gouv.fr APIs.
 * Replaces the MCP server dependency with direct HTTP calls.
 * Returns structured ParsedXxx types directly (no text intermediary).
 */

import type {
  ParsedDatasetList,
  ParsedDataset,
  ParsedResourceList,
  ParsedResource,
  ParsedTabularData,
  ParsedMetrics,
  ParsedDataserviceList,
  ParsedDataservice,
  ParsedOpenApiSpec,
  OpenApiEndpoint,
  OpenApiParam,
  OpenApiRequestBody,
  OpenApiResponse,
} from "@/lib/parsers";
import { PREVIEW_MAX_BYTES } from "@/lib/constants";

// --- Base URLs (from datagouv-mcp env_config.py) ---

const DATAGOUV_API = "https://www.data.gouv.fr/api/";
const SITE_URL = "https://www.data.gouv.fr/";
const TABULAR_API = "https://tabular-api.data.gouv.fr/api/";
const METRICS_API = "https://metric-api.data.gouv.fr/api/";
const CRAWLER_API = "https://crawler.data.gouv.fr/api/";

// --- Stop words (from datagouv-mcp search_datasets.py) ---

const STOP_WORDS = new Set([
  "données", "donnee", "donnees", "fichier", "fichiers",
  "tableau", "tableaux", "csv", "excel", "xlsx", "json", "xml",
]);

function cleanSearchQuery(query: string): string {
  const words = query.split(/\s+/);
  const cleaned = words.filter((w) => !STOP_WORDS.has(w.toLowerCase().trim()));
  return cleaned.join(" ").trim() || query.trim();
}

// --- Tabular API exceptions cache ---

let exceptionsCache: Set<string> | null = null;
let exceptionsCacheTime = 0;
const EXCEPTIONS_TTL = 3600_000; // 1 hour

async function fetchExceptions(): Promise<Set<string>> {
  const now = Date.now();
  if (exceptionsCache && now - exceptionsCacheTime < EXCEPTIONS_TTL) {
    return exceptionsCache;
  }
  try {
    const res = await fetch(`${CRAWLER_API}resources-exceptions`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return exceptionsCache ?? new Set();
    const data = await res.json();
    const ids = new Set<string>();
    for (const item of data) {
      if (item.resource_id) ids.add(item.resource_id);
    }
    exceptionsCache = ids;
    exceptionsCacheTime = now;
    return ids;
  } catch {
    return exceptionsCache ?? new Set();
  }
}

// --- Helper: extract tags from API response ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTags(tags: any[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === "string" ? t : t?.name || ""))
    .filter(Boolean);
}

// --- Helper: format filesize ---

function formatSize(bytes: number | null | undefined): string | undefined {
  if (!bytes || typeof bytes !== "number") return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// --- API Functions ---

export async function searchDatasets(
  query: string,
  page = 1,
  pageSize = 20
): Promise<ParsedDatasetList> {
  const cleanedQuery = cleanSearchQuery(query);
  const params = new URLSearchParams({
    q: cleanedQuery,
    page: String(page),
    page_size: String(Math.min(pageSize, 100)),
  });

  let res = await fetch(`${DATAGOUV_API}1/datasets/?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });

  // Fallback: if cleaned query returns nothing and differs from original, retry
  if (res.ok) {
    const data = await res.json();
    let datasets = data.data || [];

    if (datasets.length === 0 && cleanedQuery !== query.trim()) {
      const fallbackParams = new URLSearchParams({
        q: query.trim(),
        page: String(page),
        page_size: String(Math.min(pageSize, 100)),
      });
      const fallbackRes = await fetch(`${DATAGOUV_API}1/datasets/?${fallbackParams}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        datasets = fallbackData.data || [];
        return mapDatasetList(query, datasets, fallbackData.total || datasets.length);
      }
    }

    return mapDatasetList(query, datasets, data.total || datasets.length);
  }

  throw new Error(`Erreur API data.gouv.fr: HTTP ${res.status}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDatasetList(query: string, datasets: any[], total: number): ParsedDatasetList {
  return {
    type: "dataset_list",
    query,
    total,
    datasets: datasets.map((ds) => mapDataset(ds)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDataset(ds: any): ParsedDataset {
  const org = ds.organization;
  return {
    type: "dataset",
    title: ds.title || ds.name || "Sans titre",
    id: ds.id || "",
    slug: ds.slug,
    description: ds.description_short || ds.description?.substring(0, 500),
    organization: typeof org === "object" && org ? org.name : undefined,
    organizationId: typeof org === "object" && org ? org.id : undefined,
    tags: extractTags(ds.tags || []),
    resourceCount: Array.isArray(ds.resources) ? ds.resources.length : 0,
    url: `${SITE_URL}datasets/${ds.slug || ds.id}/`,
    createdAt: ds.created_at,
    lastModified: ds.last_update,
    license: ds.license,
    frequency: ds.frequency,
  };
}

export async function getDatasetInfo(datasetId: string): Promise<ParsedDataset> {
  const res = await fetch(`${DATAGOUV_API}1/datasets/${datasetId}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Dataset "${datasetId}" introuvable.`);
    throw new Error(`Erreur API: HTTP ${res.status}`);
  }
  const data = await res.json();
  return mapDataset(data);
}

export async function listDatasetResources(datasetId: string): Promise<ParsedResourceList> {
  const res = await fetch(`${DATAGOUV_API}1/datasets/${datasetId}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Erreur API: HTTP ${res.status}`);
  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources: ParsedResource[] = (data.resources || []).map((r: any) => ({
    type: "resource" as const,
    title: r.title || r.name || "Sans titre",
    id: r.id || "",
    format: r.format || "",
    size: formatSize(r.filesize),
    sizeBytes: typeof r.filesize === "number" ? r.filesize : undefined,
    mime: r.mime,
    resourceType: r.type,
    url: r.url || "",
    datasetId,
    datasetTitle: data.title,
  }));

  return {
    type: "resource_list",
    datasetTitle: data.title || "Dataset",
    datasetId,
    total: resources.length,
    resources,
  };
}

export async function getResourceInfo(resourceId: string): Promise<ParsedResource> {
  const res = await fetch(`${DATAGOUV_API}2/datasets/resources/${resourceId}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Ressource "${resourceId}" introuvable.`);
    throw new Error(`Erreur API: HTTP ${res.status}`);
  }
  const data = await res.json();
  const resource = data.resource || {};
  const datasetId = data.dataset_id;

  // Check tabular API availability
  let tabularApiAvailable = false;
  try {
    const profileRes = await fetch(`${TABULAR_API}resources/${resourceId}/profile/`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (profileRes.status === 200) {
      tabularApiAvailable = true;
    } else {
      // Check exceptions list
      const exceptions = await fetchExceptions();
      tabularApiAvailable = exceptions.has(resourceId);
    }
  } catch {
    // Could not check
  }

  return {
    type: "resource",
    title: resource.title || resource.name || "Sans titre",
    id: resource.id || resourceId,
    format: resource.format || "",
    size: formatSize(resource.filesize),
    sizeBytes: typeof resource.filesize === "number" ? resource.filesize : undefined,
    mime: resource.mime,
    resourceType: resource.type,
    url: resource.url || "",
    datasetId: datasetId ? String(datasetId) : undefined,
    tabularApiAvailable,
  };
}

export async function queryResourceData(
  resourceId: string,
  page = 1,
  pageSize = 20,
  filters?: { column: string; value: string; operator?: string },
  sort?: { column: string; direction?: string },
): Promise<ParsedTabularData> {
  const params = new URLSearchParams({
    page: String(Math.max(page, 1)),
    page_size: String(Math.max(1, Math.min(pageSize, 200))),
  });

  // Tabular API filter: column__operator=value
  if (filters?.column && filters.value !== undefined) {
    const op = filters.operator || "exact";
    params.set(`${filters.column}__${op}`, filters.value);
  }

  // Tabular API sort: column__sort=asc|desc
  if (sort?.column) {
    params.set(`${sort.column}__sort`, sort.direction || "asc");
  }

  const url = `${TABULAR_API}resources/${resourceId}/data/?${params}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    const msg = res.status === 404
      ? `Ressource ${resourceId} non disponible via la Tabular API.`
      : res.status === 410
        ? `Ressource ${resourceId} retirée (Gone) de la Tabular API.`
        : `Erreur Tabular API: HTTP ${res.status}`;
    console.warn(`[tabular] ${res.status} ${url}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
    throw new Error(msg);
  }

  const data = await res.json();
  const rows = data.data || [];
  const meta = data.meta || {};
  const totalRows = meta.total || rows.length;

  const columns = rows.length > 0
    ? Object.keys(rows[0]).filter((k) => k !== "__id")
    : [];

  const mappedRows = rows.map((row: Record<string, unknown>) => {
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "__id") continue;
      mapped[k] = v != null ? String(v) : "";
    }
    return mapped;
  });

  return {
    type: "tabular_data",
    resourceTitle: "",
    resourceId,
    question: "",
    totalRows,
    columns,
    rows: mappedRows,
    page: meta.page || page,
    totalPages: meta.page_size ? Math.ceil(totalRows / meta.page_size) : 1,
    hasMore: !!data.links?.next,
  };
}

export async function downloadAndParseResource(
  resourceId: string,
  maxRows = 20
): Promise<ParsedTabularData> {
  // Get resource URL
  const infoRes = await fetch(`${DATAGOUV_API}2/datasets/resources/${resourceId}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!infoRes.ok) throw new Error(`Ressource introuvable: HTTP ${infoRes.status}`);
  const infoData = await infoRes.json();
  const resource = infoData.resource || {};
  const resourceUrl = resource.url;
  if (!resourceUrl) throw new Error("Pas d'URL de telechargement.");

  // Try reading from download cache first, then fall back to direct download
  let text = "";
  let contentType = "";
  let usedCache = false;
  try {
    const { getCachedPath } = await import("@/lib/cache/download-cache");
    const cached = await getCachedPath(resourceId);
    if (cached) {
      const { readFile } = await import("fs/promises");
      const buf = await readFile(cached.filePath);
      text = new TextDecoder("utf-8").decode(buf);
      contentType = cached.entry.contentType;
      usedCache = true;
    }
  } catch {
    // Cache module unavailable — will download directly
  }

  if (!usedCache) {
    const dlRes = await fetch(resourceUrl, { signal: AbortSignal.timeout(300_000) });
    if (!dlRes.ok) throw new Error(`Erreur telechargement: HTTP ${dlRes.status}`);
    contentType = dlRes.headers.get("content-type") || "";
    const buffer = await dlRes.arrayBuffer();
    text = new TextDecoder("utf-8").decode(buffer);
  }

  // Detect format and parse
  const filename = resourceUrl.split("/").pop()?.split("?")[0] || "";
  const fmt = filename.toLowerCase();
  let rows: Record<string, string>[] = [];

  if (fmt.endsWith(".json") || fmt.endsWith(".jsonl") || contentType.includes("json")) {
    rows = parseJsonContent(text, maxRows);
  } else {
    // Default to CSV
    rows = parseCsvContent(text, maxRows);
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    type: "tabular_data",
    resourceTitle: resource.title || "",
    resourceId,
    question: "",
    totalRows: rows.length,
    columns,
    rows,
    hasMore: false,
  };
}

function parseCsvContent(text: string, maxRows: number): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Detect delimiter
  const sample = lines.slice(0, 5).join("\n");
  const delimiters = [",", ";", "\t", "|"];
  let delimiter = ",";
  let maxCount = 0;
  for (const d of delimiters) {
    const count = (sample.match(new RegExp(d === "|" ? "\\|" : d, "g")) || []).length;
    if (count > maxCount) {
      maxCount = count;
      delimiter = d;
    }
  }

  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const values = lines[i].split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }
  return rows;
}

function flattenValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(row, flattenObject(v as Record<string, unknown>, key));
    } else {
      row[key] = flattenValue(v);
    }
  }
  return row;
}

function parseJsonContent(text: string, maxRows: number): Record<string, string>[] {
  try {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : [data];
    return items.slice(0, maxRows).map((item) =>
      typeof item === "object" && item !== null
        ? flattenObject(item as Record<string, unknown>)
        : { value: flattenValue(item) }
    );
  } catch {
    // Try JSONL
    const lines = text.trim().split("\n");
    const rows: Record<string, string>[] = [];
    for (const line of lines.slice(0, maxRows)) {
      try {
        const item = JSON.parse(line);
        rows.push(
          typeof item === "object" && item !== null
            ? flattenObject(item as Record<string, unknown>)
            : { value: flattenValue(item) }
        );
      } catch { /* skip */ }
    }
    return rows;
  }
}

export async function searchDataservices(
  query: string,
  page = 1,
  pageSize = 20
): Promise<ParsedDataserviceList> {
  const params = new URLSearchParams({
    q: query.trim(),
    page: String(page),
    page_size: String(Math.min(pageSize, 100)),
  });

  const res = await fetch(`${DATAGOUV_API}1/dataservices/?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Erreur API: HTTP ${res.status}`);

  const data = await res.json();
  const dataservices = (data.data || []).map(mapDataservice);

  return {
    type: "dataservice_list",
    query: query.trim(),
    total: data.total || dataservices.length,
    dataservices,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDataservice(ds: any): ParsedDataservice {
  const org = ds.organization;
  return {
    type: "dataservice",
    title: ds.title || "",
    id: ds.id || "",
    description: ds.description,
    organization: typeof org === "object" && org ? org.name : undefined,
    baseApiUrl: ds.base_api_url,
    openapiSpecUrl: ds.machine_documentation_url,
    tags: extractTags(ds.tags || []),
    url: `${SITE_URL}dataservices/${ds.id}/`,
    createdAt: ds.created_at,
  };
}

export async function getDataserviceInfo(dataserviceId: string): Promise<ParsedDataservice> {
  const res = await fetch(`${DATAGOUV_API}1/dataservices/${dataserviceId}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Dataservice "${dataserviceId}" introuvable.`);
    throw new Error(`Erreur API: HTTP ${res.status}`);
  }
  return mapDataservice(await res.json());
}

// Common paths where OpenAPI/Swagger specs are often found
const SPEC_PROBE_PATHS = [
  "/swagger.json",
  "/openapi.json",
  "/api/swagger.json",
  "/api/openapi.json",
  "/api-docs",
  "/v1/swagger.json",
  "/v2/swagger.json",
  "/docs/openapi.json",
  "/spec.json",
];

async function tryFetchSpec(url: string): Promise<{ json: unknown; url: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return null;
    const json = await res.json();
    // Validate it looks like an OpenAPI spec
    if (json && typeof json === "object" && (json.paths || json.openapi || json.swagger)) {
      return { json, url };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getDataserviceOpenApiSpec(
  dataserviceId: string
): Promise<ParsedOpenApiSpec> {
  const ds = await getDataserviceInfo(dataserviceId);

  // Try the declared spec URL first
  if (ds.openapiSpecUrl) {
    try {
      const res = await fetch(ds.openapiSpecUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json, application/yaml, text/yaml" },
      });
      if (res.ok) {
        const text = await res.text();
        try {
          const spec = JSON.parse(text);
          return mapOpenApiSpec(spec, ds);
        } catch {
          // YAML — can't parse, continue to auto-discovery
        }
      }
    } catch {
      // Spec URL failed, continue to auto-discovery
    }
  }

  // Auto-discover: probe common spec paths on the base URL
  if (ds.baseApiUrl) {
    const base = ds.baseApiUrl.replace(/\/+$/, "");
    // Try all paths in parallel (first one wins)
    const probes = SPEC_PROBE_PATHS.map((path) => tryFetchSpec(base + path));
    const results = await Promise.all(probes);
    const found = results.find((r) => r !== null);
    if (found) {
      const parsed = mapOpenApiSpec(found.json, ds);
      // Note: we found the spec by auto-discovery
      parsed.description = (parsed.description || "") +
        (parsed.description ? "\n\n" : "") +
        `Spec decouverte automatiquement: ${found.url}`;
      return parsed;
    }
  }

  // No spec found anywhere
  return {
    type: "openapi_spec",
    title: ds.title,
    baseUrl: ds.baseApiUrl,
    servers: ds.baseApiUrl ? [ds.baseApiUrl] : [],
    endpoints: [],
    description: ds.openapiSpecUrl
      ? "Spec au format YAML ou inaccessible."
      : "Aucune specification OpenAPI trouvee.",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOpenApiSpec(spec: any, ds: ParsedDataservice): ParsedOpenApiSpec {
  const info = spec.info || {};
  const servers: string[] = [];

  // OpenAPI 3.x servers
  for (const s of spec.servers || []) {
    if (s.url) servers.push(s.url);
  }
  // OpenAPI 2.x (Swagger)
  if (spec.host) {
    const scheme = (spec.schemes || ["https"])[0];
    servers.push(`${scheme}://${spec.host}${spec.basePath || ""}`);
  }
  if (ds.baseApiUrl && !servers.includes(ds.baseApiUrl)) {
    servers.unshift(ds.baseApiUrl);
  }

  const allTags = new Set<string>();
  const endpoints: OpenApiEndpoint[] = [];
  const paths = spec.paths || {};

  for (const [path, methods] of Object.entries(paths)) {
    if (typeof methods !== "object" || methods === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pathParams: any[] = (methods as any).parameters || [];

    for (const [method, details] of Object.entries(methods as Record<string, unknown>)) {
      if (method.startsWith("x-") || method === "parameters" || method === "summary" || method === "description") continue;
      if (typeof details !== "object" || details === null) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = details as any;

      // Merge path-level + operation-level params
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawParams = [...pathParams, ...(d.parameters || [])] as any[];
      const params: OpenApiParam[] = rawParams.map((p) => ({
        name: p.name || "",
        in: p.in || "query",
        type: p.schema?.type || p.type || "string",
        required: p.required === true,
        description: p.description?.substring(0, 200),
        example: p.example != null ? String(p.example) : p.schema?.example != null ? String(p.schema.example) : undefined,
        enum: p.schema?.enum || p.enum,
      }));

      // Request body (OpenAPI 3.x)
      let requestBody: OpenApiRequestBody | undefined;
      if (d.requestBody?.content) {
        const contentTypes = Object.keys(d.requestBody.content);
        const ct = contentTypes.find((c: string) => c.includes("json")) || contentTypes[0];
        if (ct) {
          const schema = d.requestBody.content[ct]?.schema;
          requestBody = {
            contentType: ct,
            description: d.requestBody.description,
            required: d.requestBody.required,
            schemaPreview: schema ? JSON.stringify(schema, null, 2).substring(0, 500) : undefined,
          };
        }
      }
      // Request body (Swagger 2.x: body parameter)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!requestBody) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bodyParam = rawParams.find((p: any) => p.in === "body");
        if (bodyParam?.schema) {
          requestBody = {
            contentType: "application/json",
            description: bodyParam.description,
            required: bodyParam.required,
            schemaPreview: JSON.stringify(bodyParam.schema, null, 2).substring(0, 500),
          };
        }
      }

      // Responses
      const responses: OpenApiResponse[] = [];
      if (d.responses) {
        for (const [code, resp] of Object.entries(d.responses)) {
          responses.push({
            code,
            description: ((resp as { description?: string })?.description || "").substring(0, 200),
          });
        }
      }

      // Tags
      const opTags: string[] = Array.isArray(d.tags) ? d.tags : [];
      opTags.forEach((t: string) => allTags.add(t));

      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: (d.summary || "").substring(0, 200) || undefined,
        description: (d.description || "").substring(0, 500) || undefined,
        operationId: d.operationId,
        params,
        requestBody,
        responses,
        tags: opTags,
        deprecated: d.deprecated === true,
      });
    }
  }

  return {
    type: "openapi_spec",
    title: info.title || ds.title,
    version: info.version,
    description: info.description?.substring(0, 500),
    baseUrl: servers[0],
    servers,
    endpoints,
    tags: allTags.size > 0 ? Array.from(allTags) : undefined,
  };
}

export async function getMetrics(datasetId: string): Promise<ParsedMetrics> {
  const params = new URLSearchParams({
    dataset_id__exact: datasetId.trim(),
    metric_month__sort: "desc",
    page_size: "12",
  });

  const res = await fetch(`${METRICS_API}datasets/data/?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Erreur Metrics API: HTTP ${res.status}`);

  const payload = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: any[] = payload.data || [];

  const months = entries
    .map((e) => ({
      month: e.metric_month || "",
      visits: e.monthly_visit || 0,
      downloads: e.monthly_download_resource || 0,
    }))
    .reverse(); // chronological order

  const totalVisits = months.reduce((s, m) => s + m.visits, 0);
  const totalDownloads = months.reduce((s, m) => s + m.downloads, 0);

  return {
    type: "metrics",
    title: "",
    datasetId,
    months,
    totalVisits,
    totalDownloads,
  };
}

// --- Latest content (for landing page) ---

export async function getLatestDatasets(pageSize = 6): Promise<ParsedDatasetList> {
  const params = new URLSearchParams({
    sort: "-last_update",
    page_size: String(Math.min(pageSize, 20)),
    page: "1",
  });
  const res = await fetch(`${DATAGOUV_API}1/datasets/?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Erreur API: HTTP ${res.status}`);
  const data = await res.json();
  return mapDatasetList("", data.data || [], data.total || 0);
}

export async function getLatestDataservices(pageSize = 6): Promise<ParsedDataserviceList> {
  const params = new URLSearchParams({
    sort: "-created",
    page_size: String(Math.min(pageSize, 20)),
    page: "1",
  });
  const res = await fetch(`${DATAGOUV_API}1/dataservices/?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Erreur API: HTTP ${res.status}`);
  const data = await res.json();
  return {
    type: "dataservice_list",
    query: "",
    total: data.total || 0,
    dataservices: (data.data || []).map(mapDataservice),
  };
}

// --- Shared: get cached file path (disk cache) or download ---

async function getCachedOrDownload(resourceId: string, maxBytes: number): Promise<{
  filePath: string;
  contentType: string;
  resourceTitle: string;
  resourceUrl: string;
}> {
  // 1. Get resource info
  const infoRes = await fetch(`${DATAGOUV_API}2/datasets/resources/${resourceId}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!infoRes.ok) throw new Error(`Ressource introuvable: HTTP ${infoRes.status}`);
  const infoData = await infoRes.json();
  const resource = infoData.resource || {};
  const resourceUrl = resource.url;
  if (!resourceUrl) throw new Error("Pas d'URL de telechargement.");

  // 2. Try disk cache first
  const { getCachedPath, cacheResource } = await import("@/lib/cache/download-cache");
  const cached = await getCachedPath(resourceId);
  if (cached) {
    // Check size limit
    if (cached.entry.size > maxBytes) {
      throw new Error(`Fichier trop volumineux (${(cached.entry.size / 1024 / 1024).toFixed(1)} MB, max ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`);
    }
    return {
      filePath: cached.filePath,
      contentType: cached.entry.contentType,
      resourceTitle: resource.title || "",
      resourceUrl,
    };
  }

  // 3. Check size with HEAD before downloading
  const headRes = await fetch(resourceUrl, { method: "HEAD", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const contentLength = headRes?.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > maxBytes) {
    throw new Error(`Fichier trop volumineux (${(parseInt(contentLength) / 1024 / 1024).toFixed(1)} MB, max ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`);
  }

  // 4. Download to disk cache
  const result = await cacheResource(resourceId, resourceUrl);
  if (result.entry.size > maxBytes) {
    throw new Error(`Fichier trop volumineux (${(result.entry.size / 1024 / 1024).toFixed(1)} MB, max ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`);
  }

  return {
    filePath: result.filePath,
    contentType: result.entry.contentType,
    resourceTitle: resource.title || "",
    resourceUrl,
  };
}

// --- Raw download (for XML viewer) — reads from disk cache ---

export async function downloadResourceRaw(
  resourceId: string,
  maxBytes = PREVIEW_MAX_BYTES,
): Promise<{ content: string; contentType: string; resourceTitle: string }> {
  const { filePath, contentType, resourceTitle } = await getCachedOrDownload(resourceId, maxBytes);
  const { readFile } = await import("fs/promises");
  const buf = await readFile(filePath);
  const content = new TextDecoder("utf-8").decode(buf);
  return { content, contentType, resourceTitle };
}

// --- JSON download with truncation (for JSON viewer) — reads from disk cache ---

export interface ParsedJsonPreview {
  data: unknown;
  totalItems: number | null;
  displayedItems: number | null;
  truncated: boolean;
  resourceTitle: string;
}

/** Max bytes to read from a JSON file for preview. */
const JSON_READ_LIMIT = 2 * 1024 * 1024; // 2 MB

/** Max serialized response size sent to the browser. */
const JSON_RESPONSE_MAX = 80 * 1024; // 80 KB

export async function downloadResourceJson(
  resourceId: string,
  maxItems = 100,
  maxBytes = PREVIEW_MAX_BYTES,
): Promise<ParsedJsonPreview> {
  const { filePath, resourceTitle, resourceUrl } = await getCachedOrDownload(resourceId, maxBytes);
  const { stat, open } = await import("fs/promises");

  const fileInfo = await stat(filePath);
  const fileSize = fileInfo.size;
  const isPartialRead = fileSize > JSON_READ_LIMIT;

  const fd = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(Math.min(fileSize, JSON_READ_LIMIT));
    await fd.read(buf, 0, buf.length, 0);
    const text = buf.toString("utf-8");

    const trimmed = text.trimStart();
    const firstChar = trimmed[0];

    // --- HTML mislabeled as JSON (API docs, web pages) ---
    if (firstChar === "<" || trimmed.substring(0, 15).toLowerCase().startsWith("<!doctype")) {
      return {
        data: { _type: "html_api", ...parseHtmlApiInfo(trimmed, resourceUrl) },
        totalItems: null, displayedItems: null, truncated: false, resourceTitle,
      };
    }

    // --- JSONL (not starting with [ or {) ---
    if (firstChar !== "[" && firstChar !== "{") {
      return finalize(parseJsonl(text, maxItems, resourceTitle, isPartialRead), resourceTitle);
    }

    // --- Small enough to parse fully ---
    if (!isPartialRead) {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch {
        return finalize(parseJsonl(text, maxItems, resourceTitle, false), resourceTitle);
      }
      return finalize(truncateJson(parsed, maxItems, resourceTitle), resourceTitle);
    }

    // --- Partial read: array ---
    if (firstChar === "[") {
      return finalize(parsePartialJsonArray(text, maxItems, resourceTitle), resourceTitle);
    }

    // --- Partial read: object ---
    // Check JSONL (one object per line)
    const nl = text.indexOf("\n");
    if (nl > 0) {
      try {
        JSON.parse(text.substring(0, nl));
        return finalize(parseJsonl(text, maxItems, resourceTitle, true), resourceTitle);
      } catch { /* not JSONL */ }
    }

    // Find nested array (features, data, items, records…)
    const nested = parsePartialNestedArray(text, maxItems, resourceTitle);
    if (nested) return finalize(nested, resourceTitle);

    return {
      data: { _notice: `Fichier JSON volumineux (${(fileSize / 1024 / 1024).toFixed(1)} MB). Telechargez-le pour l'explorer.` },
      totalItems: null, displayedItems: null, truncated: true, resourceTitle,
    };
  } finally {
    await fd.close();
  }
}

/**
 * Post-process: strip GeoJSON geometry, then cap response size.
 */
/**
 * Extract useful info from an HTML page mislabeled as JSON (API docs, Swagger, ReDoc…).
 */
function parseHtmlApiInfo(html: string, resourceUrl: string): Record<string, string> {
  const info: Record<string, string> = { url: resourceUrl };

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) info.title = titleMatch[1].trim();

  // OpenAPI spec URL (ReDoc, Swagger)
  const specMatch =
    html.match(/spec-url=['"]([^'"]+)['"]/i) ||
    html.match(/url:\s*['"]([^'"]+\.(?:yml|yaml|json))['"]/i) ||
    html.match(/SwaggerUIBundle\(\s*\{[^}]*url:\s*['"]([^'"]+)['"]/i);
  if (specMatch) info.specUrl = specMatch[1];

  // Detect doc framework
  if (html.includes("redoc")) info.framework = "ReDoc";
  else if (html.includes("swagger")) info.framework = "Swagger UI";
  else info.framework = "Documentation API";

  return info;
}

function finalize(preview: ParsedJsonPreview, resourceTitle: string): ParsedJsonPreview {
  stripGeometry(preview);
  return capResponseSize(preview, resourceTitle);
}

function parseJsonl(text: string, maxItems: number, resourceTitle: string, isPartialRead: boolean): ParsedJsonPreview {
  const lines = text.split("\n");
  const items: unknown[] = [];
  for (const line of lines) {
    if (items.length >= maxItems) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { items.push(JSON.parse(trimmed)); } catch { /* skip partial line */ }
  }
  return {
    data: items,
    totalItems: isPartialRead ? null : items.length,
    displayedItems: items.length,
    truncated: isPartialRead || items.length >= maxItems,
    resourceTitle,
  };
}

function parsePartialJsonArray(text: string, maxItems: number, resourceTitle: string): ParsedJsonPreview {
  // Find the last complete item by scanning for top-level commas
  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let itemStart = -1;

  for (let i = 0; i < text.length && items.length < maxItems; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "[" || ch === "{") {
      if (depth === 1 && ch === "{" && itemStart === -1) itemStart = i;
      if (depth === 1 && ch === "[" && itemStart === -1) itemStart = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 1 && itemStart !== -1) {
        // End of a top-level item
        const slice = text.substring(itemStart, i + 1);
        try { items.push(JSON.parse(slice)); } catch { /* skip */ }
        itemStart = -1;
      }
    } else if (ch === "," && depth === 1) {
      // Primitive item between commas
      if (itemStart !== -1) {
        const slice = text.substring(itemStart, i).trim();
        try { items.push(JSON.parse(slice)); } catch { /* skip */ }
        itemStart = -1;
      }
    } else if (depth === 1 && itemStart === -1 && ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      // Start of a primitive value
      itemStart = i;
    }
  }

  return {
    data: items,
    totalItems: null, // unknown since file was truncated
    displayedItems: items.length,
    truncated: true,
    resourceTitle,
  };
}

/**
 * For truncated large JSON objects, find the first big array property
 * (e.g. "features", "data", "items", "records") and extract items from it.
 * Works on GeoJSON FeatureCollections, API responses, etc.
 */
function parsePartialNestedArray(text: string, maxItems: number, resourceTitle: string): ParsedJsonPreview | null {
  // Find the first occurrence of "key":[ pattern
  const arrayStartRe = /"(\w+)"\s*:\s*\[/g;
  let match: RegExpExecArray | null;
  while ((match = arrayStartRe.exec(text)) !== null) {
    const key = match[1];
    const bracketPos = text.indexOf("[", match.index + match[0].length - 1);
    if (bracketPos === -1) continue;

    // Extract text from [ onwards and parse items
    const arrayText = text.substring(bracketPos);
    const items = extractItemsFromPartialArray(arrayText, maxItems);
    if (items.length > 0) {
      // Try to extract the wrapper keys before the array for context
      const prefix = text.substring(0, match.index);
      const wrapper: Record<string, unknown> = {};
      // Extract simple key:value pairs from the prefix
      const kvRe = /"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|\d+(?:\.\d+)?|true|false|null)\s*[,}]/g;
      let kvMatch: RegExpExecArray | null;
      while ((kvMatch = kvRe.exec(prefix)) !== null) {
        try { wrapper[kvMatch[1]] = JSON.parse(kvMatch[2]); } catch { /* skip */ }
      }
      wrapper[key] = items;
      return {
        data: wrapper,
        totalItems: null,
        displayedItems: items.length,
        truncated: true,
        resourceTitle,
      };
    }
  }
  return null;
}

function extractItemsFromPartialArray(text: string, maxItems: number): unknown[] {
  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let itemStart = -1;

  for (let i = 0; i < text.length && items.length < maxItems; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "[" || ch === "{") {
      if (depth === 1 && itemStart === -1) itemStart = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 1 && itemStart !== -1) {
        const slice = text.substring(itemStart, i + 1);
        try { items.push(JSON.parse(slice)); } catch { /* skip incomplete */ }
        itemStart = -1;
      }
      if (depth === 0) break; // end of array
    } else if (ch === "," && depth === 1) {
      if (itemStart !== -1) {
        const slice = text.substring(itemStart, i).trim();
        try { items.push(JSON.parse(slice)); } catch { /* skip */ }
        itemStart = -1;
      }
    } else if (depth === 1 && itemStart === -1 && ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      itemStart = i;
    }
  }
  return items;
}

/**
 * Ensure the preview payload stays under JSON_RESPONSE_MAX.
 * If it's too large (e.g. GeoJSON features with huge coordinate arrays),
 * progressively halve the number of items until it fits.
 */
/**
 * Strip GeoJSON geometry coordinates (they bloat the preview and are useless to display).
 * Replaces coordinates with a short summary like "[Polygon, 1234 coords]".
 */
function stripGeometry(preview: ParsedJsonPreview): void {
  const data = preview.data;
  if (!data || typeof data !== "object") return;

  function simplifyGeom(geom: Record<string, unknown>): void {
    const type = geom.type as string;
    if (!type || !geom.coordinates) return;
    const coords = geom.coordinates;
    const count = JSON.stringify(coords).length;
    geom.coordinates = `[${type}, ~${Math.round(count / 10)} coords]` as unknown;
  }

  function processFeature(f: Record<string, unknown>): void {
    if (f.geometry && typeof f.geometry === "object") {
      simplifyGeom(f.geometry as Record<string, unknown>);
    }
  }

  // Root is a FeatureCollection
  const obj = data as Record<string, unknown>;
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    obj.features.forEach((f: unknown) => {
      if (f && typeof f === "object") processFeature(f as Record<string, unknown>);
    });
    return;
  }

  // Root is a single Feature
  if (obj.type === "Feature" && obj.geometry) {
    processFeature(obj);
    return;
  }

  // Root is an array of Features
  if (Array.isArray(data)) {
    data.forEach((item: unknown) => {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        if (o.type === "Feature" && o.geometry) processFeature(o);
      }
    });
    return;
  }

  // Nested: look one level deep for arrays of features
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      val.forEach((item: unknown) => {
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          if (o.type === "Feature" && o.geometry) processFeature(o);
        }
      });
    }
  }
}

function capResponseSize(preview: ParsedJsonPreview, resourceTitle: string): ParsedJsonPreview {
  let serialized = JSON.stringify(preview.data);
  if (serialized.length <= JSON_RESPONSE_MAX) return preview;

  // Find the array to shrink — could be root array or nested in an object
  let arr: unknown[] | null = null;
  let setArr: ((items: unknown[]) => void) | null = null;

  if (Array.isArray(preview.data)) {
    arr = preview.data;
    setArr = (items) => { preview.data = items; };
  } else if (preview.data && typeof preview.data === "object") {
    const obj = preview.data as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (Array.isArray(val) && val.length > 0) {
        arr = val;
        setArr = (items) => { obj[key] = items; };
        break;
      }
    }
  }

  if (!arr || !setArr || arr.length === 0) return preview;

  // Progressively halve until under the limit
  let count = arr.length;
  while (count > 1) {
    count = Math.max(1, Math.floor(count / 2));
    const sliced = arr.slice(0, count);
    serialized = JSON.stringify({ ...preview.data as object });
    // Quick check with just the sliced part
    setArr(sliced);
    serialized = JSON.stringify(preview.data);
    if (serialized.length <= JSON_RESPONSE_MAX) break;
  }

  preview.displayedItems = count;
  preview.truncated = true;
  return preview;
}

function truncateJson(data: unknown, maxItems: number, resourceTitle: string): ParsedJsonPreview {
  // If root is an array, truncate it
  if (Array.isArray(data)) {
    const total = data.length;
    const truncated = total > maxItems;
    return {
      data: truncated ? data.slice(0, maxItems) : data,
      totalItems: total,
      displayedItems: Math.min(total, maxItems),
      truncated,
      resourceTitle,
    };
  }

  // If root is an object, look for the first large array property and truncate it
  if (data != null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > maxItems) {
        return {
          data: { ...obj, [key]: value.slice(0, maxItems) },
          totalItems: value.length,
          displayedItems: maxItems,
          truncated: true,
          resourceTitle,
        };
      }
    }
    // Also check nested: { wrapper: { items: [...] } }
    for (const [key, value] of Object.entries(obj)) {
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        for (const [nk, nv] of Object.entries(nested)) {
          if (Array.isArray(nv) && nv.length > maxItems) {
            return {
              data: { ...obj, [key]: { ...nested, [nk]: nv.slice(0, maxItems) } },
              totalItems: nv.length,
              displayedItems: maxItems,
              truncated: true,
              resourceTitle,
            };
          }
        }
      }
    }
  }

  // No truncation needed
  return {
    data,
    totalItems: null,
    displayedItems: null,
    truncated: false,
    resourceTitle,
  };
}

// --- ZIP content listing ---

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
}

export interface ZipListing {
  entries: ZipEntry[];
  totalFiles: number;
  totalSize: number;
  resourceTitle: string;
}

export async function listZipContents(
  resourceId: string,
  maxBytes = PREVIEW_MAX_BYTES,
): Promise<ZipListing> {
  const { filePath, resourceTitle } = await getCachedOrDownload(resourceId, maxBytes);
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const entries: ZipEntry[] = [];
  let totalSize = 0;

  zip.forEach((relativePath, file) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal = file as any;
    const entry: ZipEntry = {
      name: relativePath,
      size: internal._data?.uncompressedSize ?? 0,
      compressedSize: internal._data?.compressedSize ?? 0,
      isDirectory: file.dir,
    };
    entries.push(entry);
    if (!file.dir) totalSize += entry.size;
  });

  // Sort: directories first, then by name
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    entries,
    totalFiles: entries.filter((e) => !e.isDirectory).length,
    totalSize,
    resourceTitle,
  };
}

// --- Health check ---

export async function checkHealth(): Promise<{ online: boolean; latency: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${DATAGOUV_API}1/`, {
      signal: AbortSignal.timeout(8_000),
    });
    return { online: res.ok, latency: Date.now() - start };
  } catch (err) {
    return {
      online: false,
      latency: Date.now() - start,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}
