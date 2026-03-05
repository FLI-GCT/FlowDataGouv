/**
 * Dataset tools — access dataset details, resources, tabular data, metrics.
 */

import { z } from "zod";
import * as flowdata from "../lib/flowdata.js";
import * as datagouv from "../lib/datagouv.js";
import type { ToolDef } from "./index.js";

/**
 * Try proxy first, fallback to direct data.gouv.fr API on failure.
 * Returns { data, source } so the caller knows which path was used.
 */
async function withFallback<T>(
  proxyFn: () => Promise<unknown>,
  directFn: () => Promise<T>,
): Promise<{ data: unknown; source: "proxy" | "direct" }> {
  try {
    const data = await proxyFn();
    return { data, source: "proxy" };
  } catch {
    const data = await directFn();
    return { data, source: "direct" };
  }
}

export const datasetTools: ToolDef[] = [
  {
    name: "datagouv_dataset_info",
    description: [
      "Recupere les metadonnees completes d'un dataset data.gouv.fr.",
      "Retourne : titre, description, organisation, tags, licence,",
      "nombre de ressources, dates, frequence de mise a jour.",
    ].join("\n"),
    schema: z.object({
      dataset_id: z.string().describe("ID ou slug du dataset"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("get_dataset_info", { dataset_id: args.dataset_id }),
        () => datagouv.getDatasetInfo(args.dataset_id as string),
      );
      return [{ type: "text" as const, text: formatResult("Dataset", data, source) }];
    },
  },

  {
    name: "datagouv_dataset_resources",
    description: [
      "Liste les ressources (fichiers) d'un dataset.",
      "Retourne : nom, format (CSV, JSON, XLS...), taille, URL, API tabulaire disponible.",
    ].join("\n"),
    schema: z.object({
      dataset_id: z.string().describe("ID ou slug du dataset"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("list_dataset_resources", { dataset_id: args.dataset_id }),
        () => datagouv.listDatasetResources(args.dataset_id as string),
      );
      return [{ type: "text" as const, text: formatResult("Ressources", data, source) }];
    },
  },

  {
    name: "datagouv_resource_data",
    description: [
      "Interroge les donnees tabulaires d'une ressource CSV/XLS via l'API Tabular.",
      "Supporte filtrage par colonne et tri. Operateurs : exact, contains, less, greater, strictly_less, strictly_greater.",
    ].join("\n"),
    schema: z.object({
      resource_id: z.string().describe("ID de la ressource"),
      page: z.number().optional().describe("Page (defaut: 1)"),
      page_size: z.number().optional().describe("Lignes par page (defaut: 20, max: 200)"),
      filter_column: z.string().optional().describe("Colonne a filtrer"),
      filter_value: z.string().optional().describe("Valeur du filtre"),
      filter_operator: z.enum(["exact", "contains", "less", "greater", "strictly_less", "strictly_greater"]).optional().describe("Operateur de filtre (defaut: exact)"),
      sort_column: z.string().optional().describe("Colonne de tri"),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Direction du tri (defaut: asc)"),
    }),
    handler: async (args) => {
      const proxyArgs: Record<string, unknown> = {
        resource_id: args.resource_id,
        page: args.page || 1,
        page_size: args.page_size || 20,
      };
      if (args.filter_column) {
        proxyArgs.filter_column = args.filter_column;
        proxyArgs.filter_value = args.filter_value || "";
        proxyArgs.filter_operator = args.filter_operator || "exact";
      }
      if (args.sort_column) {
        proxyArgs.sort_column = args.sort_column;
        proxyArgs.sort_direction = args.sort_direction || "asc";
      }
      const filters = args.filter_column
        ? { column: args.filter_column as string, value: (args.filter_value || "") as string, operator: args.filter_operator as string }
        : undefined;
      const sort = args.sort_column
        ? { column: args.sort_column as string, direction: args.sort_direction as string }
        : undefined;
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("query_resource_data", proxyArgs),
        () => datagouv.queryResourceData(args.resource_id as string, (args.page as number) || 1, (args.page_size as number) || 20, filters, sort),
      );
      return [{ type: "text" as const, text: formatResult("Donnees", data, source) }];
    },
  },

  {
    name: "datagouv_download_resource",
    description: [
      "Telecharge et parse une ressource (CSV, JSON, JSONL).",
      "Detection automatique du format et du delimiteur CSV.",
      "Retourne les premieres lignes du fichier parse.",
    ].join("\n"),
    schema: z.object({
      resource_id: z.string().describe("ID de la ressource"),
      max_rows: z.number().optional().describe("Nombre max de lignes (defaut: 20)"),
    }),
    handler: async (args) => {
      // No direct fallback for download — only available via FlowDataGouv proxy
      const result = await flowdata.proxyDatagouvCall("download_and_parse_resource", {
        resource_id: args.resource_id,
        max_rows: args.max_rows || 20,
      });
      return [{ type: "text" as const, text: formatResult("Fichier parse", result) }];
    },
  },

  {
    name: "datagouv_dataset_metrics",
    description: [
      "Recupere les metriques d'usage d'un dataset : visites et telechargements",
      "mensuels sur les 12 derniers mois.",
    ].join("\n"),
    schema: z.object({
      dataset_id: z.string().describe("ID du dataset"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("get_metrics", { dataset_id: args.dataset_id }),
        () => datagouv.getMetrics(args.dataset_id as string),
      );
      return [{ type: "text" as const, text: formatResult("Metriques", data, source) }];
    },
  },

  {
    name: "datagouv_resource_info",
    description: "Recupere les metadonnees d'une ressource specifique (format, taille, URL, API tabulaire).",
    schema: z.object({
      resource_id: z.string().describe("ID de la ressource"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("get_resource_info", { resource_id: args.resource_id }),
        () => datagouv.getResourceInfo(args.resource_id as string),
      );
      return [{ type: "text" as const, text: formatResult("Ressource", data, source) }];
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function formatResult(label: string, data: unknown, source?: "proxy" | "direct"): string {
  const tag = source === "direct" ? " (via data.gouv.fr direct)" : "";
  if (!data) return `${label}: aucun resultat${tag}`;
  try {
    const json = JSON.stringify(data, null, 2);
    if (json.length > 8000) {
      return `## ${label}${tag}\n\`\`\`json\n${json.slice(0, 8000)}\n...(tronque)\n\`\`\``;
    }
    return `## ${label}${tag}\n\`\`\`json\n${json}\n\`\`\``;
  } catch {
    return `${label}${tag}: ${String(data)}`;
  }
}
