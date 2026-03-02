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
  pageSize = 20
): Promise<ParsedTabularData> {
  const params = new URLSearchParams({
    page: String(Math.max(page, 1)),
    page_size: String(Math.max(1, Math.min(pageSize, 200))),
  });

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

function parseJsonContent(text: string, maxRows: number): Record<string, string>[] {
  try {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : [data];
    return items.slice(0, maxRows).map((item) => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(item)) {
        row[k] = v != null ? String(v) : "";
      }
      return row;
    });
  } catch {
    // Try JSONL
    const lines = text.trim().split("\n");
    const rows: Record<string, string>[] = [];
    for (const line of lines.slice(0, maxRows)) {
      try {
        const item = JSON.parse(line);
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(item)) {
          row[k] = v != null ? String(v) : "";
        }
        rows.push(row);
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
