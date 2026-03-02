/**
 * API/Dataservice tools — access API metadata, OpenAPI specs, and try endpoints.
 */

import { z } from "zod";
import * as flowdata from "../lib/flowdata.js";
import * as datagouv from "../lib/datagouv.js";
import type { ToolDef } from "./index.js";

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

export const apiTools: ToolDef[] = [
  {
    name: "datagouv_api_info",
    description: [
      "Recupere les metadonnees d'une API/dataservice data.gouv.fr.",
      "Retourne : titre, description, organisation, URL de base,",
      "URL de la spec OpenAPI, tags.",
    ].join("\n"),
    schema: z.object({
      dataservice_id: z.string().describe("ID du dataservice"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("get_dataservice_info", { dataservice_id: args.dataservice_id }),
        () => datagouv.getDataserviceInfo(args.dataservice_id as string),
      );
      return [{ type: "text" as const, text: formatJson("API", data, source) }];
    },
  },

  {
    name: "datagouv_api_spec",
    description: [
      "Recupere la specification OpenAPI d'un dataservice.",
      "Auto-decouvre la spec si l'URL n'est pas declaree (8 chemins testes).",
      "Retourne les endpoints avec methodes, parametres, body, reponses.",
    ].join("\n"),
    schema: z.object({
      dataservice_id: z.string().describe("ID du dataservice"),
    }),
    handler: async (args) => {
      const result = await flowdata.proxyDatagouvCall("get_dataservice_openapi_spec", {
        dataservice_id: args.dataservice_id,
      });
      return [{ type: "text" as const, text: formatJson("OpenAPI Spec", result) }];
    },
  },

  {
    name: "datagouv_api_call",
    description: [
      "Appelle un endpoint d'API publique (proxy CORS server-side).",
      "Retourne le status HTTP, les headers, le body et la duree.",
      "Protection SSRF : bloque les IPs privees.",
    ].join("\n"),
    schema: z.object({
      url: z.string().describe("URL complete de l'endpoint"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("Methode HTTP"),
      headers: z.record(z.string()).optional().describe("Headers HTTP additionnels"),
      queryParams: z.record(z.string()).optional().describe("Parametres de requete"),
      body: z.unknown().optional().describe("Body de la requete (pour POST/PUT)"),
    }),
    handler: async (args) => {
      const result = await flowdata.proxyApiCall({
        url: String(args.url),
        method: String(args.method),
        headers: args.headers as Record<string, string> | undefined,
        queryParams: args.queryParams as Record<string, string> | undefined,
        body: args.body,
      });

      const lines = [
        `## Reponse API`,
        `**Status**: ${result.status} ${result.statusText}`,
        `**Duree**: ${result.duration}ms`,
        "",
      ];

      const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
      if (body.length > 6000) {
        lines.push("```json\n" + body.slice(0, 6000) + "\n...(tronque)\n```");
      } else {
        lines.push("```json\n" + body + "\n```");
      }

      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  },

  {
    name: "datagouv_search_apis",
    description: "Recherche des APIs/dataservices sur data.gouv.fr par mot-cle.",
    schema: z.object({
      query: z.string().describe("Termes de recherche"),
      page: z.number().optional().describe("Page (defaut: 1)"),
      page_size: z.number().optional().describe("Resultats par page (defaut: 20)"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("search_dataservices", {
          query: args.query,
          page: args.page || 1,
          page_size: args.page_size || 20,
        }),
        () => datagouv.searchDataservices(args.query as string, (args.page as number) || 1, (args.page_size as number) || 20),
      );
      return [{ type: "text" as const, text: formatJson("APIs", data, source) }];
    },
  },
];

function formatJson(label: string, data: unknown, source?: "proxy" | "direct"): string {
  const tag = source === "direct" ? " (via data.gouv.fr direct)" : "";
  if (!data) return `${label}: aucun resultat${tag}`;
  const json = JSON.stringify(data, null, 2);
  if (json.length > 8000) {
    return `## ${label}${tag}\n\`\`\`json\n${json.slice(0, 8000)}\n...(tronque)\n\`\`\``;
  }
  return `## ${label}${tag}\n\`\`\`json\n${json}\n\`\`\``;
}
