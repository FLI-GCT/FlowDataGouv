/**
 * Tool registry — all MCP tools organized by category.
 */

import { z } from "zod";
import { searchTools } from "./search.js";
import { datasetTools } from "./datasets.js";
import { apiTools } from "./apis.js";
import { catalogTools } from "./catalog.js";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<
    Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
  >;
}

export interface ToolCategory {
  id: string;
  label: string;
  tools: ToolDef[];
}

export const categories: ToolCategory[] = [
  { id: "search", label: "Recherche intelligente", tools: searchTools },
  { id: "datasets", label: "Datasets & Ressources", tools: datasetTools },
  { id: "apis", label: "APIs & Dataservices", tools: apiTools },
  { id: "catalog", label: "Catalogue & Decouverte", tools: catalogTools },
];

export const allTools: ToolDef[] = categories.flatMap((c) => c.tools);
