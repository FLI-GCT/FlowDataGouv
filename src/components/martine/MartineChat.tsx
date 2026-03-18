"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Send, Sparkles, Trash2, WifiOff, Loader2, ExternalLink,
  ChevronRight, ChevronDown, Database, Search, BarChart3, Table2,
  CheckCircle2, Clock, Filter, Download, Grid3X3, TrendingUp, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/shared/MarkdownRenderer";
import type { DatasetCard, ResourceCard, ToolTrace } from "@/lib/martine/types";

// ── Types ───────────────────────────────────────────────────────

interface ToolResult { tool: string; result: Record<string, unknown> }

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: ToolResult[];
  toolTraces?: ToolTrace[];
}

const EXAMPLES = [
  "Quels datasets sur la qualité de l'air ?",
  "Trouve-moi des données sur le transport à Lyon",
  "Quelles APIs sont disponibles sur l'emploi ?",
  "Vue d'ensemble du catalogue",
];

const TOOL_LABELS: Record<string, string> = {
  search_datasets: "Recherche de datasets",
  dataset_details: "Chargement des détails",
  query_data: "Interrogation des données",
  categories: "Chargement des catégories",
  catalog_stats: "Statistiques du catalogue",
};

// ── Main ────────────────────────────────────────────────────────

interface MartineChatProps { sessionId: string; initialQuery?: string }

export function MartineChat({ sessionId: initId, initialQuery }: MartineChatProps) {
  const [sid, setSid] = useState(initId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [liveTraces, setLiveTraces] = useState<ToolTrace[]>([]);
  const [liveToolResults, setLiveToolResults] = useState<ToolResult[]>([]);
  const [thinking, setThinking] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const initSent = useRef(false);

  const scroll = useCallback(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), []);
  useEffect(() => { scroll(); }, [messages, streaming, liveTraces, liveToolResults, scroll]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", content: text.trim() }]);
    setInput(""); setLoading(true); setStreaming(""); setLiveTraces([]); setLiveToolResults([]); setThinking(null);

    try {
      const res = await fetch("/api/martine/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, message: text.trim() }),
      });
      if (res.status === 503) {
        setAvailable(false);
        setMessages((p) => [...p, { id: `e-${Date.now()}`, role: "assistant", content: "Martine n'est pas disponible." }]);
        setLoading(false); return;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const dec = new TextDecoder();
      let buf = "", acc = "";
      const traces: ToolTrace[] = [];
      const tResults: ToolResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        let ev = "";
        for (const ln of lines) {
          if (ln.startsWith("event: ")) { ev = ln.slice(7); continue; }
          if (!ln.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(ln.slice(6));
            if (ev === "delta") { setThinking(null); acc += d.content || ""; setStreaming(acc); }
            else if (ev === "done") acc = d.content || acc;
            else if (ev === "error") acc = d.message || "Erreur.";
            else if (ev === "thinking") setThinking(d.step);
            else if (ev === "tool_start") { setThinking(null); traces.push({ tool: d.tool, status: "running" }); setLiveTraces([...traces]); }
            else if (ev === "tool_end") { const t = traces.find((t) => t.tool === d.tool && t.status === "running"); if (t) { t.status = "done"; t.durationMs = d.durationMs; } setLiveTraces([...traces]); }
            else if (ev === "tool_result") {
              const t = traces.find((t) => t.tool === d.tool); if (t) t.result = d.result;
              setLiveTraces([...traces]);
              tResults.push({ tool: d.tool, result: d.result }); setLiveToolResults([...tResults]);
            }
          } catch { /* skip */ }
        }
      }

      if (acc || tResults.length || traces.length) {
        setMessages((p) => [...p, {
          id: `a-${Date.now()}`, role: "assistant", content: acc,
          toolResults: tResults.length ? tResults : undefined,
          toolTraces: traces.length ? traces : undefined,
        }]);
      }
    } catch { setMessages((p) => [...p, { id: `e-${Date.now()}`, role: "assistant", content: "Erreur de connexion." }]); }
    finally { setLoading(false); setStreaming(""); setLiveTraces([]); setLiveToolResults([]); setThinking(null); }
  }, [loading, sid]);

  useEffect(() => { if (initialQuery && !initSent.current) { initSent.current = true; send(initialQuery); } }, [initialQuery, send]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Sparkles className="h-4 w-4 text-primary" /></div>
          <div><span className="text-sm font-semibold">Martine</span><span className="ml-2 text-xs text-muted-foreground">Assistante de recherche</span></div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && <Button variant="ghost" size="icon-sm" onClick={() => { setMessages([]); setStreaming(""); setSid(crypto.randomUUID()); }} title="Nouvelle conversation"><Trash2 className="h-3.5 w-3.5" /></Button>}
          {!available && <span className="flex items-center gap-1 text-xs text-destructive"><WifiOff className="h-3 w-3" /> Indisponible</span>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {messages.length === 0 && !loading ? (
          <Welcome onSend={send} />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => <Bubble key={m.id} msg={m} onAction={send} />)}
            {/* Live */}
            {loading && (liveTraces.length > 0 || streaming || thinking) && (
              <LiveBubble traces={liveTraces} toolResults={liveToolResults} thinking={thinking} streaming={streaming} onAction={send} />
            )}
            {loading && !liveTraces.length && !streaming && !thinking && <Dots />}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t bg-background px-4 py-3 sm:px-6">
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Posez votre question..." rows={1} disabled={loading}
            className="flex-1 resize-none rounded-xl border bg-muted/30 px-4 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <Button onClick={() => send(input)} disabled={!input.trim() || loading} size="icon" className="h-10 w-10 shrink-0 rounded-xl">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Bubble (2-column on desktop for assistant) ──────────────────

function LiveBubble({ traces, toolResults, thinking, streaming, onAction }: {
  traces: ToolTrace[]; toolResults: ToolResult[]; thinking: string | null; streaming: string; onAction: (t: string) => void;
}) {
  const hasToolContent = toolResults.length > 0;
  return (
    <div className="flex gap-2.5">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10"><Sparkles className="h-3.5 w-3.5 text-primary" /></div>
      <div className="min-w-0 flex-1 space-y-2">
        {traces.length > 0 && <Traces traces={traces} />}
        {thinking && <Thinking step={thinking} />}
        {/* 2-column layout on lg when we have both tool results and text */}
        {(hasToolContent || streaming) && (
          <div className={hasToolContent && streaming ? "grid gap-3 lg:grid-cols-[1fr_1fr]" : ""}>
            {hasToolContent && (
              <div className="space-y-2 min-w-0">
                {toolResults.map((tr, i) => <ToolResultView key={i} tr={tr} onAction={onAction} />)}
              </div>
            )}
            {streaming && (
              <div className="rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3 text-sm min-w-0">
                <MarkdownRenderer content={streaming} /><span className="mt-1 inline-block h-4 w-0.5 animate-pulse bg-primary/60" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ msg, onAction }: { msg: ChatMessage; onAction: (t: string) => void }) {
  if (msg.role === "user") return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground whitespace-pre-wrap break-words">{msg.content}</div>
    </div>
  );

  const hasTools = !!msg.toolResults?.length;
  const hasText = !!msg.content;

  return (
    <div className="flex gap-2.5">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10"><Sparkles className="h-3.5 w-3.5 text-primary" /></div>
      <div className="min-w-0 flex-1 space-y-2">
        {msg.toolTraces?.length ? <Traces traces={msg.toolTraces} /> : null}
        {/* 2-column on lg: tools left, text right */}
        {(hasTools || hasText) && (
          <div className={hasTools && hasText ? "grid gap-3 lg:grid-cols-[1fr_1fr]" : ""}>
            {hasTools && (
              <div className="space-y-2 min-w-0">
                {msg.toolResults!.map((tr, i) => <ToolResultView key={i} tr={tr} onAction={onAction} />)}
              </div>
            )}
            {hasText && (
              <div className="rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3 text-sm min-w-0">
                <MarkdownRenderer content={msg.content} onAction={onAction} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool Result Dispatch ────────────────────────────────────────

function ToolResultView({ tr, onAction }: { tr: ToolResult; onAction: (t: string) => void }) {
  const r = tr.result;
  switch (tr.tool) {
    case "search_datasets": return r.results ? <DatasetCards datasets={r.results as DatasetCard[]} onAction={onAction} /> : null;
    case "dataset_details": return r.resources ? <ResourceCards resources={r.resources as ResourceCard[]} title={r.title as string} onAction={onAction} /> : null;
    case "query_data": return <QueryDataView data={r} onAction={onAction} />;
    case "categories": return r.categories ? <CategoriesView cats={r.categories as CatItem[]} onAction={onAction} /> : null;
    case "catalog_stats": return <StatsView data={r} onAction={onAction} />;
    default: return null;
  }
}

// ── Traces ──────────────────────────────────────────────────────

function Traces({ traces }: { traces: ToolTrace[] }) {
  return <div className="space-y-1">{traces.map((t, i) => <TraceItem key={i} t={t} />)}</div>;
}

function TraceItem({ t }: { t: ToolTrace }) {
  const [open, setOpen] = useState(false);
  const running = t.status === "running";
  const Icon = t.tool.includes("search") ? Search : t.tool.includes("stat") ? BarChart3 : t.tool.includes("filter") ? Filter : t.tool.includes("explore") ? Table2 : t.tool.includes("categor") ? Grid3X3 : Database;
  return (
    <div className="rounded-lg border bg-card/50 text-xs">
      <button type="button" onClick={() => !running && t.result != null && setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="flex-1 font-medium">{TOOL_LABELS[t.tool] || t.tool}</span>
        {t.durationMs != null && <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-2.5 w-2.5" />{t.durationMs < 1000 ? `${t.durationMs}ms` : `${(t.durationMs / 1000).toFixed(1)}s`}</span>}
        {!running && t.result != null && (open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />)}
      </button>
      {open && t.result != null && <div className="border-t px-3 py-2"><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">{JSON.stringify(t.result, null, 2)}</pre></div>}
    </div>
  );
}

// ── DatasetCards ─────────────────────────────────────────────────

function DatasetCards({ datasets, onAction }: { datasets: DatasetCard[]; onAction: (t: string) => void }) {
  const sorted = [...datasets].sort((a, b) => (a.explorableCount > 0 && b.explorableCount === 0) ? -1 : (b.explorableCount > 0 && a.explorableCount === 0) ? 1 : 0);
  return (
    <div className="space-y-1.5">{sorted.map((ds) => {
      const exp = ds.explorableCount > 0;
      return (
        <button key={ds.id} onClick={() => onAction(`Détails du dataset ${ds.id}`)}
          className={`group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all hover:shadow-sm ${exp ? "border-green-200 bg-green-50/50 hover:border-green-400 dark:border-green-900/50 dark:bg-green-950/20" : "bg-card hover:border-primary/40"}`}>
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${exp ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-primary/10 text-primary"}`}>{ds.number}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h4 className="text-sm font-medium leading-tight group-hover:text-primary flex-1">{ds.title}</h4>
              {exp && <span className="shrink-0 flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400"><Database className="h-2.5 w-2.5" />{ds.explorableCount} explorable{ds.explorableCount > 1 ? "s" : ""}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              {ds.organization && <span>{ds.organization}</span>}
              {ds.lastModified && ds.lastModified !== "inconnue" && <><span>·</span><span>MAJ {ds.lastModified.slice(0, 10)}</span></>}
              <span>·</span><span>{fmt(ds.views)} vues</span>
            </div>
            {exp && ds.tabularResources && <div className="mt-1 flex flex-wrap gap-1">{ds.tabularResources.slice(0, 3).map((r) => <span key={r.id} className="rounded bg-green-100/80 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/30 dark:text-green-400">{r.format} — {r.title.slice(0, 35)}</span>)}</div>}
            <div className="mt-1 flex items-center gap-2">
              {ds.category && <span className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">{ds.category}</span>}
              <a href={ds.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary"><ExternalLink className="h-2.5 w-2.5" /> data.gouv.fr</a>
            </div>
          </div>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-primary" />
        </button>
      );
    })}</div>
  );
}

// ── ResourceCards (with download all) ───────────────────────────

function ResourceCards({ resources, title, onAction }: { resources: ResourceCard[]; title?: string; onAction: (t: string) => void }) {
  const sorted = [...resources].sort((a, b) => a.tabular === b.tabular ? 0 : a.tabular ? -1 : 1);
  const expCount = resources.filter((r) => r.tabular).length;

  const downloadAll = () => {
    for (const r of resources) {
      if (r.url) {
        const a = document.createElement("a");
        a.href = r.url; a.target = "_blank"; a.rel = "noopener";
        a.click();
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <div className="text-[11px] font-medium text-muted-foreground">
          {title && <span className="font-semibold text-foreground">{title}</span>}
          {title && " — "}{resources.length} ressource{resources.length > 1 ? "s" : ""}, {expCount} exploitable{expCount > 1 ? "s" : ""}
        </div>
        <button onClick={downloadAll} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary">
          <Download className="h-3 w-3" /> Tout
        </button>
      </div>
      <div className="grid gap-1">{sorted.map((r) => (
        <div key={r.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${r.tabular ? "border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20" : "bg-card"}`}>
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono font-bold uppercase ${r.tabular ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>{r.format || "?"}</span>
          <span className="min-w-0 flex-1 truncate font-medium" title={r.title}>{r.title}</span>
          {r.size && <span className="shrink-0 text-muted-foreground">{r.size}</span>}
          <div className="flex shrink-0 items-center gap-1">
            {r.tabular && (
              <button onClick={() => onAction(`Explore la ressource ${r.id}`)} className="flex items-center gap-1 rounded-md bg-green-100 px-2 py-0.5 font-medium text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 dark:hover:bg-green-900/60">
                <Eye className="h-3 w-3" /> Explorer
              </button>
            )}
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-muted-foreground hover:text-foreground" title="Télécharger">
                <Download className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      ))}</div>
    </div>
  );
}

// ── QueryDataView (unified schema + data + filters + CSV) ────

function QueryDataView({ data, onAction }: { data: Record<string, unknown>; onAction: (t: string) => void }) {
  const cols = (data.columns || []) as ({ name: string; type: string } | string)[];
  const rows = (data.rows || data.preview || []) as Record<string, string>[];
  const total = Number(data.totalRows) || 0;
  const page = Number(data.page) || 1;
  const hasMore = Boolean(data.hasMore);
  const rid = String(data.resource_id || "");
  const err = data.error as string | undefined;
  const filters = data.filters as Array<{ column: string; value: string; operator?: string }> | null;
  const corrections = data.corrections as Array<{ requested: string; corrected: string }> | undefined;
  const suggestion = data.suggestion as string[] | undefined;

  // Normalize column names
  const colNames = cols.map((c) => typeof c === "string" ? c : c.name);
  const colTypes = cols.map((c) => typeof c === "string" ? null : c.type);

  if (err && !rows.length) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs space-y-1">
        <span className="text-destructive">{err}</span>
        {suggestion && (
          <div className="flex flex-wrap gap-1 mt-1">
            <span className="text-muted-foreground">Colonnes disponibles :</span>
            {suggestion.map((s) => (
              <button key={s} onClick={() => onAction(`Interroge la ressource ${rid} avec le filtre ${s}`)}
                className="rounded bg-card border px-1.5 py-0.5 font-medium text-[10px] hover:border-primary/40">{s}</button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (!colNames.length && !rows.length) return null;

  const displayCols = colNames.length ? colNames : rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {filters && filters.length > 0 && (
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <Filter className="h-3 w-3 text-primary shrink-0" />
              {filters.map((f, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground">+</span>}
                  <span className="font-medium">{f.column}</span>
                  <span className="text-muted-foreground">{f.operator || "contains"}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{f.value}</span>
                </span>
              ))}
              <span className="text-muted-foreground">— {fmt(total)} résultat{total > 1 ? "s" : ""}</span>
            </div>
          )}
          {!filters && <span className="text-[11px] font-medium text-muted-foreground">{colNames.length} colonnes, {fmt(total)} lignes</span>}
        </div>
        <button onClick={() => downloadCsv(displayCols, rows, `query-${rid}`)} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary shrink-0">
          <Download className="h-3 w-3" /> CSV
        </button>
      </div>

      {/* Corrections notice */}
      {corrections && corrections.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 text-[10px] text-amber-700 dark:text-amber-400">
          Correction auto : {corrections.map((c) => `"${c.requested}" → "${c.corrected}"`).join(", ")}
        </div>
      )}

      {/* Schema badges — clickable to filter (only show when no filters active) */}
      {!filters && colTypes.some(Boolean) && (
        <div className="flex flex-wrap gap-1">
          {cols.slice(0, 15).map((c, i) => {
            const name = typeof c === "string" ? c : c.name;
            const type = typeof c === "string" ? null : c.type;
            return (
              <button key={name} onClick={() => onAction(`Interroge la ressource ${rid} avec le filtre ${name}`)}
                className="group flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[10px] hover:border-primary/40 transition-colors">
                <span className="font-medium">{name}</span>
                {type && <span className="rounded bg-muted px-1 text-muted-foreground">{type}</span>}
                <Filter className="h-2.5 w-2.5 text-transparent group-hover:text-primary transition-colors" />
              </button>
            );
          })}
          {cols.length > 15 && <span className="self-center px-1 py-1 text-[10px] text-muted-foreground">+{cols.length - 15} colonnes</span>}
        </div>
      )}

      {/* Data table */}
      {rows.length > 0 && <DataTable columns={displayCols} rows={rows} rid={rid} total={total} />}

      {/* Pagination */}
      {hasMore && (
        <button onClick={() => onAction(`Page suivante de la ressource ${rid}`)} className="w-full rounded-lg border bg-card py-2 text-xs font-medium text-primary hover:bg-primary/5">
          Page suivante (page {page + 1})
        </button>
      )}
    </div>
  );
}

// ── Shared DataTable ────────────────────────────────────────────

function DataTable({ columns, rows, rid, total }: { columns: string[]; rows: Record<string, string>[]; rid: string; total: number }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const maxCols = 8;
  const visibleCols = columns.slice(0, maxCols);
  const hiddenCols = columns.slice(maxCols);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50">
            <tr>{visibleCols.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody>{rows.slice(0, 20).map((row, i) => (
            <tr key={i} className={`border-t cursor-pointer transition-colors ${expanded === i ? "bg-primary/5" : "hover:bg-muted/20"}`}
              onClick={() => setExpanded(expanded === i ? null : i)}>
              {visibleCols.map((c) => <td key={c} className="px-2 py-1 max-w-[180px] truncate" title={String(row[c] ?? "")}>{String(row[c] ?? "")}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>

      {/* Expanded row detail */}
      {expanded !== null && rows[expanded] && (
        <div className="rounded-lg border bg-primary/5 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-primary">Ligne {expanded + 1}</span>
            <button onClick={() => setExpanded(null)} className="text-muted-foreground hover:text-foreground">Fermer</button>
          </div>
          {columns.map((c) => (
            <div key={c} className="flex gap-2">
              <span className="shrink-0 font-medium text-muted-foreground w-32 truncate" title={c}>{c}</span>
              <span className="break-all">{String(rows[expanded][c] ?? "—")}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{Math.min(rows.length, 20)} / {fmt(total)} lignes · {columns.length} colonnes{hiddenCols.length > 0 ? ` (${hiddenCols.length} masquées)` : ""}</span>
      </div>
    </>
  );
}

// ── CategoriesView ──────────────────────────────────────────────

interface CatItem { slug: string; label: string; count: number; description: string }

function CategoriesView({ cats, onAction }: { cats: CatItem[]; onAction: (t: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {cats.map((c) => (
        <button key={c.slug} onClick={() => onAction(`Recherche des datasets dans la catégorie ${c.slug}`)}
          className="group rounded-lg border bg-card p-2 text-left text-xs transition-all hover:border-primary/40 hover:shadow-sm">
          <div className="font-medium group-hover:text-primary">{c.label}</div>
          <div className="mt-0.5 text-muted-foreground">{fmt(c.count)} datasets</div>
        </button>
      ))}
    </div>
  );
}

// ── StatsView ───────────────────────────────────────────────────

function StatsView({ data, onAction }: { data: Record<string, unknown>; onAction: (t: string) => void }) {
  const stats = (data.stats || {}) as Record<string, number>;
  const top = (data.topDatasets || []) as { id: string; title: string; organization: string; views: number }[];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[
          { label: "Datasets", value: stats.datasets, icon: Database },
          { label: "APIs", value: stats.apis, icon: Grid3X3 },
          { label: "Vues totales", value: stats.views, icon: TrendingUp },
          { label: "Téléchargements", value: stats.downloads, icon: Download },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border bg-card p-2.5 text-center">
            <s.icon className="mx-auto h-4 w-4 text-primary/60" />
            <div className="mt-1 text-lg font-bold text-primary">{fmt(s.value || 0)}</div>
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
      {top.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Top datasets</div>
          {top.slice(0, 5).map((d, i) => (
            <button key={d.id} onClick={() => onAction(`Détails du dataset ${d.id}`)}
              className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs text-left hover:border-primary/40">
              <span className="font-bold text-primary">{i + 1}</span>
              <span className="flex-1 truncate font-medium">{d.title}</span>
              <span className="shrink-0 text-muted-foreground">{fmt(d.views)} vues</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n || 0);
}

function downloadCsv(columns: string[], rows: Record<string, string>[], filename: string) {
  const escape = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const header = columns.map(escape).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(",")).join("\n");
  const csv = header + "\n" + body;
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function Welcome({ onSend }: { onSend: (t: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Sparkles className="h-7 w-7 text-primary" /></div>
      <h3 className="text-lg font-semibold">Bonjour, je suis Martine</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">Votre assistante pour explorer les données ouvertes françaises.</p>
      <div className="mt-6 grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLES.map((q) => <button key={q} onClick={() => onSend(q)} className="rounded-xl border bg-card px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground">{q}</button>)}
      </div>
    </div>
  );
}

function Thinking({ step }: { step: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary" /></span>
      <span className="text-primary font-medium">{step}</span><span className="text-primary/60 animate-pulse">...</span>
    </div>
  );
}

function Dots() {
  return (
    <div className="flex gap-2.5">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10"><Sparkles className="h-3.5 w-3.5 text-primary" /></div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3">
        <div className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
        <div className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
        <div className="h-2 w-2 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
      </div>
    </div>
  );
}
