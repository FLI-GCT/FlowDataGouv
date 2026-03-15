/**
 * Search & Intelligence tools — Mistral-powered search, expansion, analysis.
 * These are the "smart" tools that differentiate this MCP from basic REST wrappers.
 */

import { z } from "zod";
import * as flowdata from "../lib/flowdata.js";
import * as datagouv from "../lib/datagouv.js";
import type { ToolDef } from "./index.js";

export const searchTools: ToolDef[] = [
  {
    name: "datagouv_smart_search",
    description: [
      "Recherche intelligente dans 73 000+ datasets/APIs francaises enrichis par IA.",
      "Utilise Mistral pour corriger les fautes, generer des mots-cles, et suggerer des filtres.",
      "Scoring par pertinence avec word-boundary matching (evite les faux positifs).",
      "Retourne des resultats avec facettes dynamiques (theme, geo, type, licence).",
      "",
      "Parametres optionnels pour filtrage facetaire :",
      "- categories: slug de theme (ex: 'environnement', 'transport-mobilite')",
      "- subcategories: sous-theme enrichi par Mistral",
      "- geoScopes: 'national', 'regional', 'departemental', 'communal'",
      "- geoAreas: nom exact de lieu (ex: 'Yonne', 'Dijon', 'Île-de-France')",
      "- types: 'dataset' ou 'dataservice'",
      "- licenses: 'lov2', 'odc-odbl', 'cc-by', etc.",
    ].join("\n"),
    schema: z.object({
      query: z.string().optional().describe("Requete en langage naturel (ex: 'qualite air Dijon')"),
      categories: z.array(z.string()).optional().describe("Filtrer par theme"),
      subcategories: z.array(z.string()).optional().describe("Filtrer par sous-theme"),
      geoScopes: z.array(z.string()).optional().describe("Filtrer par niveau geo"),
      geoAreas: z.array(z.string()).optional().describe("Filtrer par zone geographique"),
      types: z.array(z.string()).optional().describe("Filtrer par type"),
      licenses: z.array(z.string()).optional().describe("Filtrer par licence"),
      sort: z.enum(["relevance", "views", "downloads", "lastModified", "quality"]).optional().describe("Tri"),
      page: z.number().optional().describe("Page (defaut: 1)"),
      pageSize: z.number().optional().describe("Resultats par page (defaut: 20, max: 100)"),
    }),
    handler: async (args) => {
      const result = await flowdata.smartSearch(args);

      // Probe Tabular API for each result in parallel
      const tabularInfo = await Promise.all(
        result.items.map(async (item) => {
          try {
            const resources = await Promise.race([
              datagouv.listDatasetResources(item.id),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
            ]);
            const csvLike = resources.filter((r: Record<string, unknown>) =>
              ["csv", "xls", "xlsx", "json", "tsv", "ods"].includes(String(r.format || "").toLowerCase()),
            );
            const checks = await Promise.all(
              csvLike.slice(0, 5).map(async (r: Record<string, unknown>) => {
                try {
                  const ok = await datagouv.isTabularAvailable(String(r.id));
                  return ok ? r : null;
                } catch { return null; }
              }),
            );
            const tabular = checks.filter(Boolean) as Record<string, unknown>[];
            return {
              id: item.id,
              count: tabular.length,
              resources: tabular.slice(0, 3).map((r) => `${r.format}: ${String(r.title || "").slice(0, 40)} (${r.id})`),
            };
          } catch { return { id: item.id, count: 0, resources: [] }; }
        }),
      );
      const tabMap = new Map(tabularInfo.map((t) => [t.id, t]));

      const lines: string[] = [];

      lines.push(`## ${result.total.toLocaleString("fr-FR")} resultats`);
      if (result.expansion?.wasExpanded) {
        lines.push(`**Requete corrigee**: ${result.expansion.corrected}`);
        lines.push(`**Mots-cles**: ${result.expansion.keywords.join(", ")}`);
      }
      const explorableCount = tabularInfo.filter((t) => t.count > 0).length;
      lines.push(`**Exploitables en ligne**: ${explorableCount}/${result.items.length}`);
      lines.push("");

      for (const item of result.items) {
        const badges = [item.categoryLabel, item.geoScope, item.geoArea].filter(Boolean).join(" | ");
        const tab = tabMap.get(item.id);
        const tabLabel = tab && tab.count > 0 ? ` ✅ ${tab.count} ressource(s) exploitable(s)` : " ⛔ non exploitable en ligne";
        lines.push(`### ${item.title}${tabLabel}`);
        lines.push(`- **ID**: ${item.id} | **Type**: ${item.type} | ${badges}`);
        lines.push(`- **Org**: ${item.organization}`);
        if (item.summary) lines.push(`- ${item.summary}`);
        lines.push(`- Vues: ${item.views} | DL: ${item.downloads} | Qualite: ${item.quality}/10`);
        if (item.score) lines.push(`- Score pertinence: ${item.score.toFixed(1)}`);
        if (tab && tab.resources.length > 0) {
          lines.push(`- **Ressources tabulaires**: ${tab.resources.join(", ")}`);
        }
        lines.push("");
      }

      // Facets summary
      const facetSummary = Object.entries(result.facets)
        .filter(([, values]) => (values as flowdata.FacetValue[]).length > 0)
        .map(([key, values]) => {
          const top = (values as flowdata.FacetValue[]).slice(0, 5).map((v) => `${v.label} (${v.count})`).join(", ");
          return `**${key}**: ${top}`;
        });
      if (facetSummary.length > 0) {
        lines.push("---\n**Facettes disponibles** :");
        lines.push(...facetSummary);
      }

      lines.push(`\nPage ${result.page}/${Math.ceil(result.total / result.pageSize)}`);

      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  },

  {
    name: "datagouv_expand_query",
    description: [
      "Expansion intelligente d'une requete par Mistral.",
      "Corrige les fautes, genere 3-5 mots-cles pertinents,",
      "detecte les categories et zones geographiques implicites.",
      "Utile pour comprendre comment la recherche interpretee une requete.",
    ].join("\n"),
    schema: z.object({
      query: z.string().describe("Requete brute de l'utilisateur"),
    }),
    handler: async (args) => {
      const result = await flowdata.expandQuery(String(args.query));
      const lines = [
        `**Original**: ${result.original}`,
        `**Corrige**: ${result.corrected}`,
        `**Mots-cles**: ${result.keywords.join(", ")}`,
        `**Expanse**: ${result.wasExpanded ? "oui" : "non"}`,
      ];
      if (result.suggestedFilters) {
        const sf = result.suggestedFilters;
        if (sf.categories?.length) lines.push(`**Categories suggerees**: ${sf.categories.join(", ")}`);
        if (sf.geoScopes?.length) lines.push(`**Niveaux geo suggeres**: ${sf.geoScopes.join(", ")}`);
        if (sf.geoAreas?.length) lines.push(`**Zones suggerees**: ${sf.geoAreas.join(", ")}`);
      }
      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  },

  {
    name: "datagouv_analyze_results",
    description: [
      "Analyse thematique des resultats de recherche par Mistral.",
      "Regroupe les datasets en 3-6 categories thematiques,",
      "fournit un resume et des observations cles.",
      "Appeler apres datagouv_smart_search avec les resultats.",
    ].join("\n"),
    schema: z.object({
      query: z.string().describe("La requete de recherche originale"),
      datasets: z.array(z.object({
        id: z.string(),
        title: z.string(),
        organization: z.string().optional(),
        tags: z.array(z.string()),
        category: z.string().optional(),
        geoScope: z.string().optional(),
      })).describe("Liste des datasets a analyser (max 50)"),
    }),
    handler: async (args) => {
      const result = await flowdata.analyzeResults(
        String(args.query),
        args.datasets as { id: string; title: string; organization?: string; tags: string[]; category?: string; geoScope?: string }[],
      );
      const lines = [`## Analyse : ${args.query}\n`, result.summary, ""];

      for (const group of result.groups) {
        lines.push(`### ${group.label} (${group.datasetIds.length} datasets)`);
        lines.push(group.description);
        lines.push(`IDs: ${group.datasetIds.join(", ")}`);
        lines.push("");
      }

      if (result.insights.length > 0) {
        lines.push("### Observations");
        for (const insight of result.insights) {
          lines.push(`- ${insight}`);
        }
      }

      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  },
];
