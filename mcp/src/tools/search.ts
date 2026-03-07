/**
 * Search & Intelligence tools — Mistral-powered search, expansion, analysis.
 * These are the "smart" tools that differentiate this MCP from basic REST wrappers.
 */

import { z } from "zod";
import * as flowdata from "../lib/flowdata.js";
import type { ToolDef } from "./index.js";

export const searchTools: ToolDef[] = [
  {
    name: "datagouv_smart_search",
    description: [
      "Recherche intelligente dans 73 000+ datasets/APIs francaises enrichis par IA.",
      "Utilise Mistral pour corriger les fautes, generer des mots-cles, et suggerer des filtres.",
      "Scoring par pertinence avec word-boundary matching (evite les faux positifs).",
      "Retourne des résultats avec facettes dynamiques (theme, geo, type, licence).",
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
      query: z.string().optional().describe("Requete en langage naturel (ex: 'qualité air Dijon')"),
      categories: z.array(z.string()).optional().describe("Filtrer par theme"),
      subcategories: z.array(z.string()).optional().describe("Filtrer par sous-theme"),
      geoScopes: z.array(z.string()).optional().describe("Filtrer par niveau geo"),
      geoAreas: z.array(z.string()).optional().describe("Filtrer par zone geographique"),
      types: z.array(z.string()).optional().describe("Filtrer par type"),
      licenses: z.array(z.string()).optional().describe("Filtrer par licence"),
      sort: z.enum(["relevance", "views", "downloads", "lastModified", "quality"]).optional().describe("Tri"),
      page: z.number().optional().describe("Page (defaut: 1)"),
      pageSize: z.number().optional().describe("Résultats par page (defaut: 20, max: 100)"),
    }),
    handler: async (args) => {
      const result = await flowdata.smartSearch(args);
      const lines: string[] = [];

      lines.push(`## ${result.total.toLocaleString("fr-FR")} résultats`);
      if (result.expansion?.wasExpanded) {
        lines.push(`**Requete corrigee**: ${result.expansion.corrected}`);
        lines.push(`**Mots-cles**: ${result.expansion.keywords.join(", ")}`);
      }
      lines.push("");

      for (const item of result.items) {
        const badges = [item.categoryLabel, item.geoScope, item.geoArea].filter(Boolean).join(" | ");
        lines.push(`### ${item.title}`);
        lines.push(`- **ID**: ${item.id} | **Type**: ${item.type} | ${badges}`);
        lines.push(`- **Org**: ${item.organization}`);
        if (item.summary) lines.push(`- ${item.summary}`);
        lines.push(`- Vues: ${item.views} | DL: ${item.downloads} | Qualité: ${item.quality}/10`);
        if (item.score) lines.push(`- Score pertinence: ${item.score.toFixed(1)}`);
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
      "Analyse thematique des résultats de recherche par Mistral.",
      "Regroupe les datasets en 3-6 categories thematiques,",
      "fournit un resume et des observations cles.",
      "Appeler apres datagouv_smart_search avec les résultats.",
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
