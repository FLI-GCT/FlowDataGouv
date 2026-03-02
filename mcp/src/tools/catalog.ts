/**
 * Catalog & discovery tools — stats, categories, latest content, health.
 */

import { z } from "zod";
import * as flowdata from "../lib/flowdata.js";
import * as datagouv from "../lib/datagouv.js";
import type { ToolDef } from "./index.js";

export const catalogTools: ToolDef[] = [
  {
    name: "datagouv_catalog_summary",
    description: [
      "Statistiques du catalogue enrichi : 73 000+ datasets, 18 categories,",
      "top datasets par popularite, repartition geographique.",
      "Donne une vue d'ensemble du portail open data francais.",
    ].join("\n"),
    schema: z.object({}),
    handler: async () => {
      const summary = await flowdata.getCatalogSummary();
      const lines = [
        "## Catalogue data.gouv.fr enrichi",
        "",
        `**Derniere sync**: ${summary.lastSync}`,
        `**Total**: ${summary.stats.total.toLocaleString("fr-FR")} items`,
        `**Enrichis**: ${summary.stats.enriched.toLocaleString("fr-FR")}`,
        "",
        "### Categories (18)",
        ...summary.categories
          .sort((a, b) => b.count - a.count)
          .map((c) => `- **${c.label}** (${c.slug}): ${c.count.toLocaleString("fr-FR")} items`),
        "",
        "### Top datasets",
        ...summary.topDatasets.slice(0, 10).map(
          (d, i) => `${i + 1}. **${d.title}** — ${d.organization} (${d.views} vues, ${d.downloads} DL)`
        ),
        "",
        "### Regions geographiques",
        ...summary.geoRegions.slice(0, 15).map((g) => `- ${g.name}: ${g.count.toLocaleString("fr-FR")} items`),
      ];
      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  },

  {
    name: "datagouv_categories",
    description: [
      "Liste les 18 categories thematiques du catalogue enrichi.",
      "Chaque categorie a un slug, un label, et un nombre d'items.",
      "Utile pour construire des filtres de recherche.",
    ].join("\n"),
    schema: z.object({}),
    handler: async () => {
      const summary = await flowdata.getCatalogSummary();
      const lines = summary.categories
        .sort((a, b) => b.count - a.count)
        .map((c) => `- **${c.label}** \`${c.slug}\` — ${c.count.toLocaleString("fr-FR")} items`);
      return [{ type: "text" as const, text: "## Categories disponibles\n\n" + lines.join("\n") }];
    },
  },

  {
    name: "datagouv_latest_datasets",
    description: "Recupere les derniers datasets mis a jour sur data.gouv.fr.",
    schema: z.object({
      count: z.number().optional().describe("Nombre de datasets (defaut: 10, max: 50)"),
    }),
    handler: async (args) => {
      const count = Math.min(typeof args.count === "number" ? args.count : 10, 50);
      let data: unknown;
      let source: "proxy" | "direct" = "proxy";
      try {
        data = await flowdata.proxyDatagouvCall("get_latest_datasets", { page_size: count });
      } catch {
        data = await datagouv.getLatestDatasets(count);
        source = "direct";
      }
      return [{ type: "text" as const, text: formatJson("Derniers datasets", data, source) }];
    },
  },

  {
    name: "datagouv_latest_apis",
    description: "Recupere les dernieres APIs/dataservices creees sur data.gouv.fr.",
    schema: z.object({
      count: z.number().optional().describe("Nombre d'APIs (defaut: 10, max: 50)"),
    }),
    handler: async (args) => {
      const count = Math.min(typeof args.count === "number" ? args.count : 10, 50);
      let data: unknown;
      let source: "proxy" | "direct" = "proxy";
      try {
        data = await flowdata.proxyDatagouvCall("get_latest_dataservices", { page_size: count });
      } catch {
        data = await datagouv.getLatestDataservices(count);
        source = "direct";
      }
      return [{ type: "text" as const, text: formatJson("Dernieres APIs", data, source) }];
    },
  },

  {
    name: "datagouv_health",
    description: "Verifie l'etat de sante du serveur FlowDataGouv et de data.gouv.fr.",
    schema: z.object({}),
    handler: async () => {
      try {
        const health = await flowdata.checkHealth();
        return [{
          type: "text" as const,
          text: `FlowDataGouv: **${health.status}** (${health.timestamp})\nRecherche intelligente disponible.`,
        }];
      } catch {
        return [{
          type: "text" as const,
          text: "FlowDataGouv: **hors ligne**\nLa recherche intelligente n'est pas disponible. Les outils de base data.gouv.fr restent fonctionnels.",
        }];
      }
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
