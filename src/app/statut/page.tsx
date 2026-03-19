"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Server, Clock, RefreshCw, ExternalLink, CheckCircle2, XCircle,
  Loader2, Copy, Check, Wrench, Zap, BookOpen, Terminal,
} from "lucide-react";

interface McpStatus {
  online: boolean;
  latency?: number;
  toolCount?: number;
  error?: string;
  checkedAt: string;
}

export default function McpPage() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/status");
      setStatus(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const MCP_URL = "https://demo-fli.fr/mcp";

  return (
    <main className="flex-1">
      <div className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              Serveur MCP FlowDataGouv
            </h1>
            <p className="text-sm text-muted-foreground">
              Connectez votre agent IA aux 73 000+ datasets francais
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Rafraichir
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-10">

        {/* Status */}
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Statut</p>
              {loading && !status ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : status?.online ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                  </span>
                  <span className="font-medium text-green-700 dark:text-green-400">En ligne</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="font-medium text-red-600">Hors ligne</span>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Endpoint</p>
              <div className="flex items-center gap-1">
                <code className="text-sm font-mono text-primary">{MCP_URL}</code>
                <button onClick={() => copyToClipboard(MCP_URL, "url")} className="text-muted-foreground hover:text-foreground">
                  {copied === "url" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Latence</p>
              <p className="text-sm font-medium">{status?.latency != null ? `${status.latency} ms` : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Outils</p>
              <p className="text-sm font-medium">{status?.toolCount ?? 19} disponibles</p>
            </div>
          </div>
          {status?.checkedAt && (
            <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Clock className="h-3 w-3" />
              Derniere verification : {new Date(status.checkedAt).toLocaleString("fr-FR")}
            </p>
          )}
        </Card>

        {/* Quick Start */}
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Ajouter ce MCP a votre agent
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Claude Desktop */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 font-bold text-sm">C</div>
                <h3 className="font-semibold">Claude Desktop</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Fichier <code className="bg-muted px-1 rounded">claude_desktop_config.json</code>
              </p>
              <CodeBlock id="claude" onCopy={copyToClipboard} copied={copied} code={JSON.stringify({
                mcpServers: {
                  flowdatagouv: {
                    type: "streamableHttp",
                    url: MCP_URL
                  }
                }
              }, null, 2)} />
            </Card>

            {/* Cursor */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm">Cu</div>
                <h3 className="font-semibold">Cursor</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Fichier <code className="bg-muted px-1 rounded">.cursor/mcp.json</code>
              </p>
              <CodeBlock id="cursor" onCopy={copyToClipboard} copied={copied} code={JSON.stringify({
                mcpServers: {
                  flowdatagouv: {
                    url: MCP_URL
                  }
                }
              }, null, 2)} />
            </Card>

            {/* Claude Code */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-8 w-8 p-1 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600" />
                <h3 className="font-semibold">Claude Code (CLI)</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Dans <code className="bg-muted px-1 rounded">.claude/settings.json</code>
              </p>
              <CodeBlock id="claudecode" onCopy={copyToClipboard} copied={copied} code={JSON.stringify({
                mcpServers: {
                  flowdatagouv: {
                    type: "url",
                    url: MCP_URL
                  }
                }
              }, null, 2)} />
            </Card>

            {/* Generic / OpenAI */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 font-bold text-sm">*</div>
                <h3 className="font-semibold">Autre client MCP</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Tout client compatible MCP (Streamable HTTP)
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">URL :</span>
                  <code className="bg-muted px-2 py-1 rounded font-mono text-xs flex-1">{MCP_URL}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">Transport :</span>
                  <span>Streamable HTTP (POST)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">Auth :</span>
                  <span>Aucune (acces public)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">Version :</span>
                  <span>MCP 2025-03-26</span>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* Tools overview */}
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            19 outils disponibles
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                category: "Recherche",
                tools: [
                  { name: "datagouv_smart_search", desc: "Recherche intelligente avec correction orthographique et scoring" },
                  { name: "datagouv_expand_query", desc: "Expansion de requete (mots-cles, filtres suggeres)" },
                  { name: "datagouv_analyze_results", desc: "Analyse thematique des resultats de recherche" },
                ],
              },
              {
                category: "Datasets",
                tools: [
                  { name: "datagouv_dataset_info", desc: "Metadonnees completes d'un dataset" },
                  { name: "datagouv_dataset_resources", desc: "Liste des fichiers avec disponibilite tabulaire" },
                  { name: "datagouv_dataset_metrics", desc: "Visites et telechargements sur 12 mois" },
                  { name: "datagouv_latest_datasets", desc: "Derniers datasets mis a jour" },
                ],
              },
              {
                category: "Donnees tabulaires",
                tools: [
                  { name: "datagouv_resource_schema", desc: "Schema des colonnes (noms, types, formats)" },
                  { name: "datagouv_resource_data", desc: "Interrogation avec filtres multiples + schema inclus" },
                  { name: "datagouv_download_resource", desc: "Telecharge et parse CSV/JSON (< 50 Mo)" },
                  { name: "datagouv_resource_info", desc: "Metadonnees d'une ressource" },
                ],
              },
              {
                category: "APIs",
                tools: [
                  { name: "datagouv_search_apis", desc: "Rechercher des APIs publiques" },
                  { name: "datagouv_api_info", desc: "Metadonnees d'une API" },
                  { name: "datagouv_api_spec", desc: "Specification OpenAPI" },
                  { name: "datagouv_api_call", desc: "Appel proxy vers une API" },
                ],
              },
              {
                category: "Catalogue",
                tools: [
                  { name: "datagouv_catalog_summary", desc: "Stats globales + top datasets + geo" },
                  { name: "datagouv_categories", desc: "18 categories thematiques avec comptages" },
                  { name: "datagouv_latest_apis", desc: "Dernieres APIs creees" },
                  { name: "datagouv_health", desc: "Verification de sante du serveur" },
                ],
              },
            ].map((cat) => (
              <Card key={cat.category} className="p-4">
                <h3 className="font-semibold text-sm mb-3">{cat.category}</h3>
                <div className="space-y-2">
                  {cat.tools.map((t) => (
                    <div key={t.name} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <code className="text-xs font-mono font-semibold">{t.name}</code>
                        <p className="text-[11px] text-muted-foreground">{t.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Use cases */}
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Exemples d&apos;utilisation
          </h2>
          <div className="space-y-4">
            {[
              { prompt: "Quels datasets sur la qualite de l'air en Ile-de-France ?", flow: "smart_search → dataset_info → resource_data" },
              { prompt: "Trouve l'entreprise Flow Line Integration dans la base SIRENE", flow: "search_sirene → entreprise detail" },
              { prompt: "Quelles APIs existent pour le geocodage ?", flow: "search_apis → api_spec" },
              { prompt: "Compare les donnees demographiques Lyon vs Dijon", flow: "smart_search (×2) → resource_data (×2)" },
            ].map((ex) => (
              <Card key={ex.prompt} className="p-4">
                <p className="text-sm font-medium italic">&laquo; {ex.prompt} &raquo;</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {ex.flow.split(" → ").map((step, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted-foreground text-xs">→</span>}
                      <Badge variant="secondary" className="text-[10px] font-mono">{step}</Badge>
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Links */}
        <section className="border-t pt-8">
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Specification MCP
            </a>
            <a href="https://www.data.gouv.fr" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> data.gouv.fr
            </a>
            <a href="https://github.com/FLI-GCT/FlowDataGouv" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Code source
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

// ── Code Block with copy button ──────────────────────────────

function CodeBlock({ id, code, onCopy, copied }: { id: string; code: string; onCopy: (text: string, id: string) => void; copied: string | null }) {
  return (
    <div className="relative">
      <pre className="rounded-lg bg-muted/50 border p-3 text-xs font-mono overflow-x-auto">{code}</pre>
      <button
        onClick={() => onCopy(code, id)}
        className="absolute top-2 right-2 rounded-md bg-background border p-1 text-muted-foreground hover:text-foreground"
      >
        {copied === id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
