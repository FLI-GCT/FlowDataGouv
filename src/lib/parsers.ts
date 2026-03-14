/**
 * Parse MCP text results into structured data for rich rendering.
 * The MCP server returns plain text - we parse it into typed objects.
 */

export interface ParsedDatasetList {
  type: "dataset_list";
  query: string;
  total: number;
  datasets: ParsedDataset[];
}

export interface ParsedDataset {
  type: "dataset";
  title: string;
  id: string;
  slug?: string;
  description?: string;
  organization?: string;
  organizationId?: string;
  tags: string[];
  resourceCount: number;
  url: string;
  createdAt?: string;
  lastModified?: string;
  license?: string;
  frequency?: string;
}

export interface ParsedResourceList {
  type: "resource_list";
  datasetTitle: string;
  datasetId: string;
  total: number;
  resources: ParsedResource[];
}

export interface ParsedResource {
  type: "resource";
  title: string;
  id: string;
  format: string;
  size?: string;
  sizeBytes?: number;
  mime?: string;
  resourceType?: string;
  url: string;
  datasetId?: string;
  datasetTitle?: string;
  tabularApiAvailable?: boolean;
}

export interface ParsedResourceSchema {
  type: "resource_schema";
  resourceId: string;
  totalColumns: number;
  columns: { name: string; type: string; format: string }[];
}

export interface ParsedTabularData {
  type: "tabular_data";
  resourceTitle: string;
  resourceId: string;
  datasetTitle?: string;
  datasetId?: string;
  question: string;
  totalRows: number;
  columns: string[];
  rows: Record<string, string>[];
  page?: number;
  totalPages?: number;
  hasMore: boolean;
}

export interface ParsedMetrics {
  type: "metrics";
  title: string;
  datasetId?: string;
  months: { month: string; visits: number; downloads: number }[];
  totalVisits: number;
  totalDownloads: number;
}

export interface ParsedDataserviceList {
  type: "dataservice_list";
  query: string;
  total: number;
  dataservices: ParsedDataservice[];
}

export interface ParsedDataservice {
  type: "dataservice";
  title: string;
  id: string;
  description?: string;
  organization?: string;
  baseApiUrl?: string;
  openapiSpecUrl?: string;
  tags: string[];
  url: string;
  createdAt?: string;
}

export interface OpenApiParam {
  name: string;
  in: string;
  type: string;
  required: boolean;
  description?: string;
  example?: string;
  enum?: string[];
}

export interface OpenApiRequestBody {
  contentType: string;
  description?: string;
  required?: boolean;
  schemaPreview?: string;
}

export interface OpenApiResponse {
  code: string;
  description: string;
}

export interface OpenApiEndpoint {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  params: OpenApiParam[];
  requestBody?: OpenApiRequestBody;
  responses: OpenApiResponse[];
  tags: string[];
  deprecated?: boolean;
}

export interface ParsedOpenApiSpec {
  type: "openapi_spec";
  title: string;
  version?: string;
  description?: string;
  baseUrl?: string;
  servers: string[];
  endpoints: OpenApiEndpoint[];
  tags?: string[];
}

export type ParsedToolResult =
  | ParsedDatasetList
  | ParsedDataset
  | ParsedResourceList
  | ParsedResource
  | ParsedTabularData
  | ParsedMetrics
  | ParsedDataserviceList
  | ParsedDataservice
  | ParsedOpenApiSpec
  | { type: "raw"; content: string };

// ---------- Parsers ----------

export function parseToolResult(toolName: string, rawResult: unknown): ParsedToolResult {
  const text = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);

  try {
    switch (toolName) {
      case "search_datasets":
        return parseDatasetSearch(text);
      case "get_dataset_info":
        return parseDatasetInfo(text);
      case "list_dataset_resources":
        return parseResourceList(text);
      case "get_resource_info":
        return parseResourceInfo(text);
      case "query_resource_data":
        return parseTabularData(text);
      case "download_and_parse_resource":
        return parseTabularData(text);
      case "search_dataservices":
        return parseDataserviceSearch(text);
      case "get_dataservice_info":
        return parseDataserviceInfo(text);
      case "get_dataservice_openapi_spec":
        return parseOpenApiSpec(text);
      case "get_metrics":
        return parseMetrics(text);
      default:
        return { type: "raw", content: text };
    }
  } catch {
    return { type: "raw", content: text };
  }
}

function parseDatasetSearch(text: string): ParsedDatasetList {
  const totalMatch = text.match(/Found (\d+) dataset/);
  const queryMatch = text.match(/for query: '([^']+)'/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;
  const query = queryMatch ? queryMatch[1] : "";

  const datasets: ParsedDataset[] = [];
  // Match numbered entries like "1. Title\n   ID: ...\n   Organization: ..."
  const entryRegex = /\d+\.\s+(.+)\n\s+ID:\s+(\S+)\n(?:\s+Organization:\s+(.+)\n)?(?:\s+Tags:\s+(.+)\n)?(?:\s+Resources:\s+(\d+)\n)?\s+URL:\s+(\S+)/g;
  let match;
  while ((match = entryRegex.exec(text)) !== null) {
    datasets.push({
      type: "dataset",
      title: match[1].trim(),
      id: match[2].trim(),
      organization: match[3]?.trim(),
      tags: match[4] ? match[4].split(",").map((t) => t.trim()).filter(Boolean) : [],
      resourceCount: match[5] ? parseInt(match[5]) : 0,
      url: match[6].trim(),
    });
  }

  return { type: "dataset_list", query, total, datasets };
}

function parseDatasetInfo(text: string): ParsedDataset {
  const titleMatch = text.match(/Dataset Information:\s+(.+)/);
  const idMatch = text.match(/ID:\s+(\S+)/);
  const slugMatch = text.match(/Slug:\s+(\S+)/);
  const urlMatch = text.match(/URL:\s+(\S+)/);
  const orgMatch = text.match(/Organization:\s+(.+)/);
  const orgIdMatch = text.match(/Organization ID:\s+(\S+)/);
  const descMatch = text.match(/Full description:\s+([\s\S]*?)(?=\n\nOrganization:)/);
  const resourcesMatch = text.match(/Resources:\s+(\d+)/);
  const createdMatch = text.match(/Created:\s+(\S+)/);
  const lastModMatch = text.match(/Last updated:\s+(\S+)/);
  const licenseMatch = text.match(/License:\s+(.+)/);
  const freqMatch = text.match(/Update frequency:\s+(.+)/);
  const tagsMatch = text.match(/Tags:\s+(.+)/);

  return {
    type: "dataset",
    title: titleMatch?.[1]?.trim() || "Dataset",
    id: idMatch?.[1]?.trim() || "",
    slug: slugMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
    organization: orgMatch?.[1]?.trim(),
    organizationId: orgIdMatch?.[1]?.trim(),
    tags: tagsMatch ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean) : [],
    resourceCount: resourcesMatch ? parseInt(resourcesMatch[1]) : 0,
    url: urlMatch?.[1]?.trim() || "",
    createdAt: createdMatch?.[1]?.trim(),
    lastModified: lastModMatch?.[1]?.trim(),
    license: licenseMatch?.[1]?.trim(),
    frequency: freqMatch?.[1]?.trim(),
  };
}

function parseResourceList(text: string): ParsedResourceList {
  const titleMatch = text.match(/Resources in dataset:\s+(.+)/);
  const datasetIdMatch = text.match(/Dataset ID:\s+(\S+)/);
  const totalMatch = text.match(/Total resources:\s+(\d+)/);

  const resources: ParsedResource[] = [];
  const entryRegex = /\d+\.\s+(.+)\n\s+Resource ID:\s+(\S+)\n\s+Format:\s+(\S+)\n(?:\s+Size:\s+(.+)\n)?(?:\s+MIME type:\s+(\S+)\n)?(?:\s+Type:\s+(\S+)\n)?\s+URL:\s+(\S+)/g;
  let match;
  while ((match = entryRegex.exec(text)) !== null) {
    resources.push({
      type: "resource",
      title: match[1].trim(),
      id: match[2].trim(),
      format: match[3].trim(),
      size: match[4]?.trim(),
      mime: match[5]?.trim(),
      resourceType: match[6]?.trim(),
      url: match[7].trim(),
    });
  }

  return {
    type: "resource_list",
    datasetTitle: titleMatch?.[1]?.trim() || "Dataset",
    datasetId: datasetIdMatch?.[1]?.trim() || "",
    total: totalMatch ? parseInt(totalMatch[1]) : resources.length,
    resources,
  };
}

function parseResourceInfo(text: string): ParsedResource {
  const titleMatch = text.match(/Resource Information:\s+(.+)/);
  const idMatch = text.match(/Resource ID:\s+(\S+)/);
  const formatMatch = text.match(/Format:\s+(\S+)/);
  const sizeMatch = text.match(/Size:\s+(.+)/);
  const mimeMatch = text.match(/MIME type:\s+(\S+)/);
  const urlMatch = text.match(/URL:\s+(\S+)/);
  const datasetIdMatch = text.match(/Dataset ID:\s+(\S+)/);
  const datasetTitleMatch = text.match(/Dataset:\s+(.+)/);
  const tabularMatch = text.match(/Tabular API availability:\n(.+)/);
  const isTabular = tabularMatch ? !tabularMatch[1].includes("Not available") : false;

  return {
    type: "resource",
    title: titleMatch?.[1]?.trim() || "Resource",
    id: idMatch?.[1]?.trim() || "",
    format: formatMatch?.[1]?.trim() || "",
    size: sizeMatch?.[1]?.trim(),
    mime: mimeMatch?.[1]?.trim(),
    url: urlMatch?.[1]?.trim() || "",
    datasetId: datasetIdMatch?.[1]?.trim(),
    datasetTitle: datasetTitleMatch?.[1]?.trim(),
    tabularApiAvailable: isTabular,
  };
}

function parseTabularData(text: string): ParsedTabularData {
  const titleMatch = text.match(/Querying resource:\s+(.+)/);
  const resourceIdMatch = text.match(/Resource ID:\s+(\S+)/);
  const datasetTitleMatch = text.match(/Dataset:\s+(.+?)(?:\s+\(ID:)/);
  const datasetIdMatch = text.match(/\(ID:\s+(\S+?)\)/);
  const questionMatch = text.match(/Question:\s+(.+)/);
  const totalRowsMatch = text.match(/Total rows[^:]*:\s+(\d+)/);
  const columnsMatch = text.match(/Columns:\s+(.+)/);
  const pageMatch = text.match(/page\s+(\d+)/);
  const totalPagesMatch = text.match(/Total pages:\s+(\d+)/);

  const columns = columnsMatch
    ? columnsMatch[1].split(",").map((c) => c.trim())
    : [];

  const rows: Record<string, string>[] = [];
  // Parse "Row N:" blocks
  const rowBlocks = text.split(/\s+Row \d+:/);
  for (let i = 1; i < rowBlocks.length; i++) {
    const row: Record<string, string> = {};
    const fieldRegex = /\s+(\S+):\s+(.*)/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(rowBlocks[i])) !== null) {
      row[fieldMatch[1]] = fieldMatch[2].trim();
    }
    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  const totalRows = totalRowsMatch ? parseInt(totalRowsMatch[1]) : rows.length;

  // Also try parsing download_and_parse_resource format
  if (rows.length === 0 && text.includes("Parsed data")) {
    const dataMatch = text.match(/Parsed data[\s\S]*?(\[[\s\S]*)/);
    if (dataMatch) {
      try {
        const parsed = JSON.parse(dataMatch[1]);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            rows.push(
              Object.fromEntries(
                Object.entries(item).map(([k, v]) => [k, String(v)])
              )
            );
          }
          if (rows.length > 0 && columns.length === 0) {
            columns.push(...Object.keys(rows[0]));
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  return {
    type: "tabular_data",
    resourceTitle: titleMatch?.[1]?.trim() || "Resource",
    resourceId: resourceIdMatch?.[1]?.trim() || "",
    datasetTitle: datasetTitleMatch?.[1]?.trim(),
    datasetId: datasetIdMatch?.[1]?.trim(),
    question: questionMatch?.[1]?.trim() || "",
    totalRows,
    columns,
    rows,
    page: pageMatch ? parseInt(pageMatch[1]) : 1,
    totalPages: totalPagesMatch ? parseInt(totalPagesMatch[1]) : 1,
    hasMore: totalRows > rows.length,
  };
}

function parseMetrics(text: string): ParsedMetrics {
  const titleMatch = text.match(/Dataset Metrics:\s+(.+)/);
  const datasetIdMatch = text.match(/Dataset ID:\s+(\S+)/);
  const totalVisitsMatch = text.match(/Total\s+([\d,]+)\s+([\d,]+)/);

  const months: { month: string; visits: number; downloads: number }[] = [];
  const monthRegex = /(\d{4}-\d{2})\s+([\d,]+)\s+([\d,]+)/g;
  let match;
  while ((match = monthRegex.exec(text)) !== null) {
    if (match[1] !== "Total") {
      months.push({
        month: match[1],
        visits: parseInt(match[2].replace(/,/g, "")),
        downloads: parseInt(match[3].replace(/,/g, "")),
      });
    }
  }

  return {
    type: "metrics",
    title: titleMatch?.[1]?.trim() || "Dataset",
    datasetId: datasetIdMatch?.[1]?.trim(),
    months: months.reverse(), // Chronological order
    totalVisits: totalVisitsMatch
      ? parseInt(totalVisitsMatch[1].replace(/,/g, ""))
      : months.reduce((s, m) => s + m.visits, 0),
    totalDownloads: totalVisitsMatch
      ? parseInt(totalVisitsMatch[2].replace(/,/g, ""))
      : months.reduce((s, m) => s + m.downloads, 0),
  };
}

function parseDataserviceSearch(text: string): ParsedDataserviceList {
  const totalMatch = text.match(/Found (\d+) dataservice/);
  const queryMatch = text.match(/for query: '([^']+)'/);

  const dataservices: ParsedDataservice[] = [];
  const entryRegex = /\d+\.\s+(.+)\n\s+ID:\s+(\S+)\n(?:\s+Description:\s+([\s\S]*?)\n)?(?:\s+Organization:\s+(.+)\n)?(?:\s+Base API URL:\s+(\S+)\n)?(?:\s+Tags:\s+(.+)\n)?\s+URL:\s+(\S+)/g;
  let match;
  while ((match = entryRegex.exec(text)) !== null) {
    dataservices.push({
      type: "dataservice",
      title: match[1].trim(),
      id: match[2].trim(),
      description: match[3]?.trim(),
      organization: match[4]?.trim(),
      baseApiUrl: match[5]?.trim(),
      tags: match[6] ? match[6].split(",").map((t) => t.trim()).filter(Boolean) : [],
      url: match[7].trim(),
    });
  }

  return {
    type: "dataservice_list",
    query: queryMatch?.[1] || "",
    total: totalMatch ? parseInt(totalMatch[1]) : dataservices.length,
    dataservices,
  };
}

function parseDataserviceInfo(text: string): ParsedDataservice {
  const titleMatch = text.match(/Dataservice Information:\s+(.+)/);
  const idMatch = text.match(/ID:\s+(\S+)/);
  const descMatch = text.match(/Description:\s+([\s\S]*?)(?=\n\nBase API URL:|\n\nOrganization:)/);
  const orgMatch = text.match(/Organization:\s+(.+)/);
  const baseUrlMatch = text.match(/Base API URL:\s+(\S+)/);
  const specUrlMatch = text.match(/OpenAPI\/Swagger spec:\s+(\S+)/);
  const urlMatch = text.match(/URL:\s+(\S+)/);
  const tagsMatch = text.match(/Tags:\s+(.+)/);
  const createdMatch = text.match(/Created:\s+(\S+)/);

  return {
    type: "dataservice",
    title: titleMatch?.[1]?.trim() || "API",
    id: idMatch?.[1]?.trim() || "",
    description: descMatch?.[1]?.trim(),
    organization: orgMatch?.[1]?.trim(),
    baseApiUrl: baseUrlMatch?.[1]?.trim(),
    openapiSpecUrl: specUrlMatch?.[1]?.trim(),
    tags: tagsMatch ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean) : [],
    url: urlMatch?.[1]?.trim() || "",
    createdAt: createdMatch?.[1]?.trim(),
  };
}

function parseOpenApiSpec(text: string): ParsedOpenApiSpec {
  const titleMatch = text.match(/OpenAPI spec for:\s+(.+)/);
  const versionMatch = text.match(/Version:\s+(.+)/);
  const descMatch = text.match(/Description:\s+(.+)/);
  const baseUrlMatch = text.match(/Base API URL:\s+(\S+)/);

  const servers: string[] = [];
  const serverRegex = /- (https?:\/\/\S+)/g;
  let sMatch;
  while ((sMatch = serverRegex.exec(text.split("Endpoints")[0] || "")) !== null) {
    servers.push(sMatch[1]);
  }

  const endpoints: OpenApiEndpoint[] = [];
  const endpointRegex = /(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\n\s+(.+)/g;
  let eMatch;
  while ((eMatch = endpointRegex.exec(text)) !== null) {
    const params: OpenApiParam[] = [];
    const startIdx = eMatch.index + eMatch[0].length;
    const nextEndpoint = text.indexOf("\n  GET ", startIdx);
    const nextEndpoint2 = text.indexOf("\n  POST ", startIdx);
    const endIdx = Math.min(
      nextEndpoint > 0 ? nextEndpoint : Infinity,
      nextEndpoint2 > 0 ? nextEndpoint2 : Infinity,
      text.length
    );
    const paramBlock = text.slice(startIdx, endIdx);
    const paramRegex = /- (\S+)\s+\[(\S+),\s*(\S*)\]/g;
    let pMatch;
    while ((pMatch = paramRegex.exec(paramBlock)) !== null) {
      params.push({
        name: pMatch[1],
        in: pMatch[2],
        type: "string",
        required: pMatch[3] === "required",
      });
    }

    endpoints.push({
      method: eMatch[1],
      path: eMatch[2],
      summary: eMatch[3]?.trim(),
      params,
      responses: [],
      tags: [],
    });
  }

  return {
    type: "openapi_spec",
    title: titleMatch?.[1]?.trim() || "API",
    version: versionMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
    baseUrl: baseUrlMatch?.[1]?.trim(),
    servers,
    endpoints,
  };
}
