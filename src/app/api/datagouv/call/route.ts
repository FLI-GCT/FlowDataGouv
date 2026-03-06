import { NextResponse } from "next/server";
import {
  searchDatasets,
  getDatasetInfo,
  listDatasetResources,
  getResourceInfo,
  queryResourceData,
  downloadAndParseResource,
  downloadResourceRaw,
  downloadResourceJson,
  listZipContents,
  searchDataservices,
  getDataserviceInfo,
  getDataserviceOpenApiSpec,
  getMetrics,
  getLatestDatasets,
  getLatestDataservices,
} from "@/lib/datagouv/api";
import type { McpCallRequest } from "@/types/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (args: Record<string, any>) => Promise<unknown>;

const TOOL_MAP: Record<string, ToolHandler> = {
  search_datasets: (a) =>
    searchDatasets(a.query || "", a.page || 1, a.page_size || 20),
  get_dataset_info: (a) => getDatasetInfo(a.dataset_id),
  list_dataset_resources: (a) => listDatasetResources(a.dataset_id),
  get_resource_info: (a) => getResourceInfo(a.resource_id),
  query_resource_data: (a) =>
    queryResourceData(
      a.resource_id, a.page || 1, a.page_size || 20,
      a.filter_column ? { column: a.filter_column, value: a.filter_value, operator: a.filter_operator } : undefined,
      a.sort_column ? { column: a.sort_column, direction: a.sort_direction } : undefined,
    ),
  download_and_parse_resource: (a) =>
    downloadAndParseResource(a.resource_id, a.max_rows || 50),
  download_resource_raw: (a) =>
    downloadResourceRaw(a.resource_id, a.max_bytes || 5 * 1024 * 1024),
  download_resource_json: (a) =>
    downloadResourceJson(a.resource_id, a.max_items || 100),
  list_zip_contents: (a) =>
    listZipContents(a.resource_id, a.max_bytes || 50 * 1024 * 1024),
  search_dataservices: (a) =>
    searchDataservices(a.query || "", a.page || 1, a.page_size || 20),
  get_dataservice_info: (a) => getDataserviceInfo(a.dataservice_id),
  get_dataservice_openapi_spec: (a) =>
    getDataserviceOpenApiSpec(a.dataservice_id),
  get_metrics: (a) => getMetrics(a.dataset_id),
  get_latest_datasets: (a) => getLatestDatasets(a.page_size || 6),
  get_latest_dataservices: (a) => getLatestDataservices(a.page_size || 6),
};

export async function POST(request: Request) {
  let body: McpCallRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.tool || typeof body.tool !== "string") {
    return NextResponse.json(
      { error: "tool name is required" },
      { status: 400 }
    );
  }

  const handler = TOOL_MAP[body.tool];
  if (!handler) {
    return NextResponse.json(
      { error: `Outil inconnu : ${body.tool}` },
      { status: 400 }
    );
  }

  try {
    const result = await handler(body.args || {});

    // Cache stable data (latest lists, dataset info) for 5 min
    const cacheableTools = new Set([
      "get_latest_datasets", "get_latest_dataservices",
      "get_dataset_info", "list_dataset_resources",
      "get_resource_info", "get_dataservice_info",
    ]);
    const headers: Record<string, string> = {};
    if (cacheableTools.has(body.tool)) {
      headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=120";
    }

    return NextResponse.json({ result, parsed: true }, { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur API data.gouv.fr";
    console.error(`[datagouv] ${body.tool} error:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
