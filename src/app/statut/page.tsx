"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Globe,
  Wrench,
  Server,
  Clock,
  RefreshCw,
  ExternalLink,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  FileText,
  Database,
  Download,
  BarChart3,
  Zap,
  Info,
} from "lucide-react";
import Link from "next/link";

interface McpStatus {
  online: boolean;
  latency?: number;
  toolCount?: number;
  error?: string;
  checkedAt: string;
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  search_datasets: Search,
  get_dataset_info: FileText,
  list_dataset_resources: Database,
  get_resource_info: Info,
  query_resource_data: Zap,
  download_and_parse_resource: Download,
  search_dataservices: Globe,
  get_dataservice_info: Globe,
  get_dataservice_openapi_spec: Globe,
  get_metrics: BarChart3,
};

const TOOL_CATEGORIES: Record<string, string[]> = {
  "Datasets": ["search_datasets", "get_dataset_info", "list_dataset_resources"],
  "Ressources": ["get_resource_info", "query_resource_data", "download_and_parse_resource"],
  "APIs / Dataservices": ["search_dataservices", "get_dataservice_info", "get_dataservice_openapi_spec"],
  "Metriques": ["get_metrics"],
};

export default function McpExplorerPage() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [tools, setTools] = useState<McpToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const statusRes = await fetch("/api/mcp/status");
      const statusData: McpStatus = await statusRes.json();
      setStatus(statusData);
      setTools(getKnownTools());
    } catch {
      setTools(getKnownTools());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <main className="flex-1">
      {/* Sub-header */}
      <div className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              Statut du serveur
            </h1>
            <p className="text-sm text-muted-foreground">
              FlowDataGouv - Etat des services et outils disponibles
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Rafraichir
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        {/* Status Card */}
        <section>
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5" />
            Statut du serveur
          </h2>
          <Card className="p-5">
            {loading && !status ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verification...
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Statut</p>
                  <div className="flex items-center gap-2">
                    {status?.online ? (
                      <>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                        </span>
                        <span className="font-medium text-green-700 dark:text-green-400">En ligne</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-red-700 dark:text-red-400">Hors ligne</span>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">API</p>
                  <a
                    href="https://www.data.gouv.fr/api/1/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-primary hover:underline flex items-center gap-1"
                  >
                    data.gouv.fr/api
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Latence</p>
                  <p className="text-sm font-medium">
                    {status?.latency != null ? `${status.latency}ms` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Outils</p>
                  <p className="text-sm font-medium">
                    {status?.toolCount ?? tools.length} disponibles
                  </p>
                </div>
              </div>
            )}
            {status?.error && (
              <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {status.error}
              </div>
            )}
            {status?.checkedAt && (
              <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground/60">
                <Clock className="h-3 w-3" />
                Derniere verification : {new Date(status.checkedAt).toLocaleString("fr-FR")}
              </p>
            )}
          </Card>
        </section>

        {/* Protocol Info */}
        <section>
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Protocole
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Transport</p>
              <p className="text-sm font-medium">Streamable HTTP (POST)</p>
              <p className="mt-1 text-xs text-muted-foreground">JSON-RPC 2.0 via HTTP POST</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Version MCP</p>
              <p className="text-sm font-medium">2025-03-26</p>
              <p className="mt-1 text-xs text-muted-foreground">Protocole MCP officiel</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Authentification</p>
              <p className="text-sm font-medium">Aucune</p>
              <p className="mt-1 text-xs text-muted-foreground">Acces public, sans cle API</p>
            </Card>
          </div>
        </section>

        {/* Tools by Category */}
        <section>
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Outils disponibles ({tools.length})
          </h2>

          {Object.entries(TOOL_CATEGORIES).map(([category, toolNames]) => {
            const categoryTools = tools.filter((t) => toolNames.includes(t.name));
            if (categoryTools.length === 0) return null;

            return (
              <div key={category} className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {category}
                </h3>
                <div className="space-y-2">
                  {categoryTools.map((tool) => {
                    const Icon = TOOL_ICONS[tool.name] || Wrench;
                    const isExpanded = expandedTool === tool.name;
                    const params = tool.inputSchema?.properties
                      ? Object.entries(tool.inputSchema.properties)
                      : [];
                    const required = tool.inputSchema?.required || [];

                    return (
                      <Card key={tool.name} className="overflow-hidden">
                        <button
                          onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                          className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-semibold font-mono">{tool.name}</code>
                              {status?.online ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                              {tool.description}
                            </p>
                          </div>
                          {params.length > 0 && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {params.length} param{params.length > 1 ? "s" : ""}
                            </Badge>
                          )}
                        </button>

                        {isExpanded && params.length > 0 && (
                          <div className="border-t bg-muted/20 px-4 py-3">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">Parametres</p>
                            <div className="space-y-2">
                              {params.map(([name, schema]) => (
                                <div key={name} className="flex items-start gap-2">
                                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                    {name}
                                  </code>
                                  {required.includes(name) && (
                                    <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                      requis
                                    </Badge>
                                  )}
                                  <span className="text-[11px] text-muted-foreground/80">
                                    {schema.type}
                                  </span>
                                  {schema.description && (
                                    <span className="text-[11px] text-muted-foreground flex-1">
                                      — {schema.description}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* Use Cases */}
        <section>
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Cas d&apos;usage
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "Rechercher des donnees",
                description: "Trouvez des datasets par mots-clés, explorez les ressources, interrogez les CSV.",
                tools: ["search_datasets", "list_dataset_resources", "query_resource_data"],
                example: "Quels datasets sur l'education nationale ?",
              },
              {
                title: "Analyser des fichiers",
                description: "Interrogez des fichiers CSV/XLSX directement en langage naturel via la Tabular API.",
                tools: ["query_resource_data", "download_and_parse_resource"],
                example: "Montre-moi les 10 plus gros budgets par section",
              },
              {
                title: "Decouvrir des APIs",
                description: "Explorez les 325+ APIs publiques et leurs specifications OpenAPI.",
                tools: ["search_dataservices", "get_dataservice_openapi_spec"],
                example: "Quelles APIs pour le geocodage ?",
              },
              {
                title: "Mesurer la popularite",
                description: "Consultez les statistiques de visites et telechargements mensuels.",
                tools: ["get_metrics"],
                example: "Metriques du dataset SIRENE",
              },
            ].map((useCase) => (
              <Card key={useCase.title} className="p-4">
                <h3 className="font-semibold">{useCase.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{useCase.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {useCase.tools.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-mono">
                      {t}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground italic">&laquo; {useCase.example} &raquo;</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Links */}
        <section className="border-t pt-8">
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <a
              href="https://github.com/datagouv/datagouv-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Code source MCP data.gouv.fr
            </a>
            <a
              href="https://www.data.gouv.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              data.gouv.fr
            </a>
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Specification MCP
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * Known tools from our tool-definitions.ts - used as fallback.
 */
function getKnownTools(): McpToolDef[] {
  return [
    {
      name: "search_datasets",
      description: "Rechercher des datasets sur data.gouv.fr par mots-clés. Retourne titre, description, organisation, tags et nombre de ressources.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mots-clés de recherche" },
          page: { type: "number", description: "Numero de page (defaut: 1)" },
          page_size: { type: "number", description: "Resultats par page (defaut: 20, max: 100)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_dataset_info",
      description: "Obtenir les metadonnees detaillees d'un dataset : titre, description, organisation, tags, dates, licence, frequence de MAJ.",
      inputSchema: {
        type: "object",
        properties: {
          dataset_id: { type: "string", description: "ID ou slug du dataset" },
        },
        required: ["dataset_id"],
      },
    },
    {
      name: "list_dataset_resources",
      description: "Lister toutes les ressources (fichiers) d'un dataset. Retourne ID, titre, format, taille, type MIME et URL.",
      inputSchema: {
        type: "object",
        properties: {
          dataset_id: { type: "string", description: "ID ou slug du dataset" },
        },
        required: ["dataset_id"],
      },
    },
    {
      name: "get_resource_info",
      description: "Obtenir les metadonnees d'une ressource : format, taille, MIME, URL, description et disponibilite Tabular API.",
      inputSchema: {
        type: "object",
        properties: {
          resource_id: { type: "string", description: "ID de la ressource (UUID)" },
        },
        required: ["resource_id"],
      },
    },
    {
      name: "query_resource_data",
      description: "Interroger des donnees tabulaires (CSV/XLSX) en langage naturel via la Tabular API. Supporte filtre, tri et pagination.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "Question en langage naturel" },
          resource_id: { type: "string", description: "ID de la ressource (UUID)" },
          page: { type: "number", description: "Numero de page (defaut: 1)" },
          page_size: { type: "number", description: "Resultats par page (defaut: 20, max: 200)" },
          filter_column: { type: "string", description: "Colonne de filtre" },
          filter_value: { type: "string", description: "Valeur de filtre" },
          filter_operator: { type: "string", description: "Operateur: exact, contains, less, greater" },
          sort_column: { type: "string", description: "Colonne de tri" },
          sort_direction: { type: "string", description: "Direction: asc ou desc" },
        },
        required: ["question", "resource_id"],
      },
    },
    {
      name: "download_and_parse_resource",
      description: "Telecharger et parser un fichier directement. Supporte CSV, CSV.GZ, JSON et JSONL.",
      inputSchema: {
        type: "object",
        properties: {
          resource_id: { type: "string", description: "ID de la ressource (UUID)" },
          max_rows: { type: "number", description: "Nombre max de lignes (defaut: 20)" },
          max_size_mb: { type: "number", description: "Taille max en MB (defaut: 500)" },
        },
        required: ["resource_id"],
      },
    },
    {
      name: "search_dataservices",
      description: "Rechercher des APIs (dataservices) enregistrees sur data.gouv.fr. Retourne titre, description, organisation et URL de base.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mots-clés" },
          page: { type: "number", description: "Numero de page" },
          page_size: { type: "number", description: "Resultats par page" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_dataservice_info",
      description: "Obtenir les metadonnees d'une API : titre, description, organisation, URL de base, spec OpenAPI, licence et datasets associes.",
      inputSchema: {
        type: "object",
        properties: {
          dataservice_id: { type: "string", description: "ID du dataservice" },
        },
        required: ["dataservice_id"],
      },
    },
    {
      name: "get_dataservice_openapi_spec",
      description: "Consulter la specification OpenAPI/Swagger d'un dataservice. Affiche les endpoints, methodes, chemins et parametres.",
      inputSchema: {
        type: "object",
        properties: {
          dataservice_id: { type: "string", description: "ID du dataservice" },
        },
        required: ["dataservice_id"],
      },
    },
    {
      name: "get_metrics",
      description: "Obtenir les metriques d'usage (visites et telechargements) mensuels d'un dataset ou d'une ressource.",
      inputSchema: {
        type: "object",
        properties: {
          dataset_id: { type: "string", description: "ID du dataset" },
          resource_id: { type: "string", description: "ID de la ressource" },
          limit: { type: "number", description: "Nombre de mois (defaut: 12, max: 100)" },
        },
        required: [],
      },
    },
  ];
}
