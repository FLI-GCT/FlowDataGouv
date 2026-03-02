import { NextResponse } from "next/server";
import {
  searchDatasets,
  getDatasetInfo,
  listDatasetResources,
  getResourceInfo,
  queryResourceData,
  downloadAndParseResource,
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
    queryResourceData(a.resource_id, a.page || 1, a.page_size || 20),
  download_and_parse_resource: (a) =>
    downloadAndParseResource(a.resource_id, a.max_rows || 50),
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
    return NextResponse.json({ result, parsed: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur API data.gouv.fr";
    console.error(`[datagouv] ${body.tool} error:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
