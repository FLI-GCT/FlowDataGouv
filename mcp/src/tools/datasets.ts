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
      "Liste les ressources (fichiers) d'un dataset avec verification de l'API tabulaire.",
      "Retourne : nom, format (CSV, JSON, XLS...), taille, URL.",
      "Indique quelles ressources sont exploitables en ligne (API tabulaire disponible).",
      "INCLUT le schema (colonnes, types) de chaque ressource tabulaire.",
      "Vous pouvez ensuite appeler datagouv_resource_data directement avec les filtres.",
    ].join("\n"),
    schema: z.object({
      dataset_id: z.string().describe("ID ou slug du dataset"),
    }),
    handler: async (args) => {
      const resources = await datagouv.listDatasetResources(args.dataset_id as string);
      // Probe Tabular API + fetch schema for CSV/XLS/JSON resources
      const TABULAR_FORMATS = new Set(["csv", "xls", "xlsx", "json", "tsv", "ods"]);
      type ResourceProbed = Record<string, unknown> & {
        tabularAvailable: boolean;
        schema?: Array<{ name: string; type: string }>;
      };
      const probed: ResourceProbed[] = await Promise.all(
        resources.map(async (r: Record<string, unknown>) => {
          const fmt = String(r.format || "").toLowerCase();
          if (!TABULAR_FORMATS.has(fmt)) return { ...r, tabularAvailable: false };
          // getResourceSchema calls /profile/ — same endpoint as isTabularAvailable
          // If it succeeds, the resource is tabular AND we get the schema
          try {
            const s = await datagouv.getResourceSchema(String(r.id));
            return { ...r, tabularAvailable: true, schema: s.columns };
          } catch {
            return { ...r, tabularAvailable: false };
          }
        }),
      );
      const explorable = probed.filter((r) => r.tabularAvailable);
      const lines = [
        `## Ressources (${probed.length} fichiers, ${explorable.length} exploitables en ligne)\n`,
      ];
      for (const r of probed) {
        const mark = r.tabularAvailable ? "✅" : "—";
        lines.push(`- ${mark} **${r.title}** (${r.format}, ${r.filesize || "?"}) — \`${r.id}\``);
        if (r.schema && r.schema.length > 0) {
          const cols = r.schema.map((c) => `${c.name} (${c.type})`).join(", ");
          lines.push(`  Colonnes: ${cols}`);
        }
      }
      if (explorable.length > 0) {
        lines.push(`\n**Ressources exploitables** : utilisez datagouv_resource_data avec les IDs et colonnes ci-dessus.`);
      }
      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  },

  {
    name: "datagouv_resource_data",
    description: [
      "Interroge les donnees tabulaires d'une ressource CSV/XLS via l'API Tabular.",
      "IMPORTANT: le schema des colonnes est TOUJOURS retourne avec les donnees.",
      "Les noms de colonnes sont corriges automatiquement (fuzzy match).",
      "Operateurs de filtre: exact (defaut), contains (texte), less, greater (numerique).",
      "Si vous ne connaissez pas les colonnes, appelez sans filtre pour voir le schema.",
      "Fallback automatique par telechargement si l'API Tabular n'est pas disponible.",
    ].join("\n"),
    schema: z.object({
      resource_id: z.string().describe("ID de la ressource"),
      page: z.number().optional().describe("Page (defaut: 1)"),
      page_size: z.number().optional().describe("Lignes par page (defaut: 20, max: 200)"),
      filter_column: z.string().optional().describe("Colonne a filtrer (filtre unique, compat ancien format)"),
      filter_value: z.string().optional().describe("Valeur du filtre"),
      filter_operator: z.enum(["exact", "contains", "less", "greater", "strictly_less", "strictly_greater"]).optional().describe("Operateur de filtre (defaut: exact)"),
      filters: z.array(z.object({
        column: z.string().describe("Nom de colonne"),
        value: z.string().describe("Valeur"),
        operator: z.enum(["exact", "contains", "less", "greater"]).optional().describe("Operateur"),
      })).optional().describe("Filtres multiples (alternative a filter_column/value)"),
      sort_column: z.string().optional().describe("Colonne de tri"),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Direction du tri (defaut: asc)"),
    }),
    handler: async (args) => {
      const rid = args.resource_id as string;
      const page = (args.page as number) || 1;
      const pageSize = (args.page_size as number) || 20;

      // Build filters array (support both old single-filter and new multi-filter)
      const filterList: Array<{ column: string; value: string; operator?: string }> = [];
      if (args.filters && Array.isArray(args.filters)) {
        for (const f of args.filters as Array<{ column: string; value: string; operator?: string }>) {
          filterList.push(f);
        }
      } else if (args.filter_column) {
        filterList.push({
          column: args.filter_column as string,
          value: (args.filter_value || "") as string,
          operator: (args.filter_operator || "exact") as string,
        });
      }

      const sort = args.sort_column
        ? { column: args.sort_column as string, direction: (args.sort_direction || "asc") as string }
        : undefined;

      // Always fetch schema first
      let schema: string[] = [];
      let schemaColumns: Array<{ name: string; type: string }> = [];
      try {
        const s = await datagouv.getResourceSchema(rid);
        schemaColumns = s.columns;
        schema = s.columns.map((c) => `${c.name} (${c.type})`);
      } catch { /* schema unavailable */ }

      // Fuzzy-match filter column names against real schema
      const warnings: string[] = [];
      if (schemaColumns.length > 0 && filterList.length > 0) {
        const colIndex = new Map<string, string>();
        for (const col of schemaColumns) {
          colIndex.set(normalizeColName(col.name), col.name);
        }
        for (const f of filterList) {
          const normalized = normalizeColName(f.column);
          const realName = colIndex.get(normalized);
          if (realName) {
            if (realName !== f.column) {
              warnings.push(`Colonne "${f.column}" corrigee en "${realName}"`);
            }
            f.column = realName;
          } else {
            // Try partial match (column name contained in real name or vice versa)
            let found = false;
            for (const [normKey, realKey] of colIndex) {
              if (normKey.includes(normalized) || normalized.includes(normKey)) {
                warnings.push(`Colonne "${f.column}" corrigee en "${realKey}" (match partiel)`);
                f.column = realKey;
                found = true;
                break;
              }
            }
            if (!found) {
              warnings.push(`Colonne "${f.column}" introuvable — filtre ignore`);
              f.column = ""; // will be skipped by queryResourceData
            }
          }
        }
      }
      // Remove invalid filters (empty column name)
      const validFilters = filterList.filter((f) => f.column);

      // Also fuzzy-match sort column
      if (sort && schemaColumns.length > 0) {
        const colIndex = new Map<string, string>();
        for (const col of schemaColumns) colIndex.set(normalizeColName(col.name), col.name);
        const normalized = normalizeColName(sort.column);
        const realName = colIndex.get(normalized);
        if (realName) {
          sort.column = realName;
        } else {
          warnings.push(`Colonne de tri "${sort.column}" introuvable — tri ignore`);
          sort.column = "";
        }
      }
      const validSort = sort && sort.column ? sort : undefined;

      // Try Tabular API first
      try {
        const data = await datagouv.queryResourceData(rid, page, pageSize, validFilters.length ? validFilters : undefined, validSort);
        const lines = [
          schema.length ? `**Schema**: ${schema.join(", ")}` : "",
          warnings.length ? `**Corrections**: ${warnings.join("; ")}` : "",
          `**Donnees**: ${data.totalRows} lignes, page ${data.page || page}`,
          "",
          formatResult("Resultats", data),
        ].filter(Boolean);
        return [{ type: "text" as const, text: lines.join("\n") }];
      } catch (tabularErr) {
        const errMsg = tabularErr instanceof Error ? tabularErr.message : "";
        // On 400 (invalid filter), return schema + available columns instead of fallback
        if (errMsg.includes("400")) {
          const colNames = schemaColumns.map((c) => c.name);
          const lines = [
            schema.length ? `**Schema**: ${schema.join(", ")}` : "",
            `⚠️ Filtre invalide: ${errMsg}`,
            colNames.length ? `**Colonnes disponibles**: ${colNames.join(", ")}` : "",
            warnings.length ? `**Corrections tentees**: ${warnings.join("; ")}` : "",
          ].filter(Boolean);
          return [{ type: "text" as const, text: lines.join("\n") }];
        }
        // For other errors (404, 500, timeout), try download fallback
        try {
          const result = await flowdata.proxyDatagouvCall("download_and_parse_resource", {
            resource_id: rid,
            max_rows: pageSize,
          });
          const lines = [
            schema.length ? `**Schema**: ${schema.join(", ")}` : "",
            formatResult("Donnees (via telechargement)", result),
          ].filter(Boolean);
          return [{ type: "text" as const, text: lines.join("\n") }];
        } catch (dlErr) {
          const msg = dlErr instanceof Error ? dlErr.message : "Erreur inconnue";
          const lines = [
            schema.length ? `**Schema disponible**: ${schema.join(", ")}` : "",
            `Donnees non disponibles: ${msg}`,
          ].filter(Boolean);
          return [{ type: "text" as const, text: lines.join("\n") }];
        }
      }
    },
  },

  {
    name: "datagouv_download_resource",
    description: [
      "Telecharge et parse une ressource fichier (CSV, JSON, JSONL, XLS).",
      "Fichiers jusqu'a 500 Mo supportes — caches sur disque automatiquement.",
      "Detection automatique du format et du delimiteur CSV.",
      "Retourne les premieres lignes du fichier parse.",
      "Utilisez cet outil quand l'API Tabular n'est pas disponible pour la ressource.",
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

  {
    name: "datagouv_resource_schema",
    description: [
      "Recupere le schema (colonnes, types) d'une ressource tabulaire.",
      "APPELEZ CECI EN PREMIER si vous devez filtrer des donnees avec resource_data:",
      "les noms de colonnes exacts sont necessaires pour les filtres.",
      "Note: datagouv_resource_data retourne aussi le schema automatiquement.",
      "Retourne : nom de colonne, type (string/int/float/date...), format detecte.",
    ].join("\n"),
    schema: z.object({
      resource_id: z.string().describe("ID de la ressource"),
    }),
    handler: async (args) => {
      const { data, source } = await withFallback(
        () => flowdata.proxyDatagouvCall("get_resource_schema", { resource_id: args.resource_id }),
        () => datagouv.getResourceSchema(args.resource_id as string),
      );
      return [{ type: "text" as const, text: formatResult("Schema", data, source) }];
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────

/** Normalize column name for fuzzy matching: lowercase, strip accents, strip separators */
function normalizeColName(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[-_.\s]/g, ""); // strip separators
}

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
