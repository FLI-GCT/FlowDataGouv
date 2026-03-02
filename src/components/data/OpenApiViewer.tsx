"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown,
  ChevronRight,
  Server,
  Play,
  Clock,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type {
  ParsedOpenApiSpec,
  OpenApiEndpoint,
  OpenApiParam,
} from "@/lib/parsers";

const METHOD_STYLES: Record<
  string,
  { bg: string; border: string; badge: string }
> = {
  GET: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-300 dark:border-emerald-800",
    badge: "bg-emerald-600 text-white",
  },
  POST: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-300 dark:border-blue-800",
    badge: "bg-blue-600 text-white",
  },
  PUT: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-300 dark:border-amber-800",
    badge: "bg-amber-600 text-white",
  },
  DELETE: {
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-300 dark:border-red-800",
    badge: "bg-red-600 text-white",
  },
  PATCH: {
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-300 dark:border-purple-800",
    badge: "bg-purple-600 text-white",
  },
};

const DEFAULT_STYLE = {
  bg: "bg-muted/30",
  border: "border-border",
  badge: "bg-muted-foreground text-white",
};

interface TryItState {
  paramValues: Record<string, string>;
  bodyValue: string;
  response: {
    status: number;
    statusText: string;
    body: unknown;
    duration: number;
  } | null;
  loading: boolean;
  error?: string;
}

interface OpenApiViewerProps {
  spec: ParsedOpenApiSpec;
}

export function OpenApiViewer({ spec }: OpenApiViewerProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggleEndpoint(idx: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  // Group endpoints by tag (or "default" if no tags)
  const grouped = groupEndpoints(spec.endpoints);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold text-lg">{spec.title}</h3>
        {spec.version && (
          <Badge variant="outline" className="text-xs font-mono">
            v{spec.version}
          </Badge>
        )}
      </div>

      {spec.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {spec.description}
        </p>
      )}

      {/* Servers */}
      {spec.servers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          {spec.servers.map((s) => (
            <Badge
              key={s}
              variant="secondary"
              className="font-mono text-[10px]"
            >
              {s}
            </Badge>
          ))}
        </div>
      )}

      {/* Endpoints by group */}
      {grouped.map(({ tag, endpoints: eps }) => (
        <div key={tag} className="space-y-2">
          {grouped.length > 1 && (
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mt-4">
              {tag}
            </h4>
          )}
          {eps.map(({ endpoint, globalIdx }) => (
            <EndpointBlock
              key={globalIdx}
              endpoint={endpoint}
              isExpanded={expanded.has(globalIdx)}
              onToggle={() => toggleEndpoint(globalIdx)}
              baseUrl={spec.baseUrl || spec.servers[0] || ""}
            />
          ))}
        </div>
      ))}

      {spec.endpoints.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          Aucun endpoint documente dans cette specification.
        </p>
      )}
    </div>
  );
}

function groupEndpoints(endpoints: OpenApiEndpoint[]) {
  const groups = new Map<
    string,
    { endpoint: OpenApiEndpoint; globalIdx: number }[]
  >();

  endpoints.forEach((ep, idx) => {
    const tag = ep.tags[0] || "default";
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push({ endpoint: ep, globalIdx: idx });
  });

  return Array.from(groups.entries()).map(([tag, endpoints]) => ({
    tag,
    endpoints,
  }));
}

function EndpointBlock({
  endpoint,
  isExpanded,
  onToggle,
  baseUrl,
}: {
  endpoint: OpenApiEndpoint;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
}) {
  const style = METHOD_STYLES[endpoint.method] || DEFAULT_STYLE;
  const [tryIt, setTryIt] = useState<TryItState>({
    paramValues: {},
    bodyValue: endpoint.requestBody?.schemaPreview || "",
    response: null,
    loading: false,
  });
  const [showTryIt, setShowTryIt] = useState(false);

  const executeTryIt = useCallback(async () => {
    setTryIt((prev) => ({ ...prev, loading: true, error: undefined, response: null }));

    // Build URL
    let url = baseUrl + endpoint.path;
    const queryParams: Record<string, string> = {};

    for (const param of endpoint.params) {
      const val = tryIt.paramValues[param.name] || "";
      if (param.in === "path") {
        url = url.replace(`{${param.name}}`, encodeURIComponent(val));
      } else if (param.in === "query" && val) {
        queryParams[param.name] = val;
      }
    }

    try {
      const res = await fetch("/api/dataservice/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          method: endpoint.method,
          queryParams,
          body:
            tryIt.bodyValue && ["POST", "PUT", "PATCH"].includes(endpoint.method)
              ? JSON.parse(tryIt.bodyValue)
              : undefined,
        }),
      });
      const json = await res.json();
      setTryIt((prev) => ({
        ...prev,
        loading: false,
        response: {
          status: json.status,
          statusText: json.statusText,
          body: json.body,
          duration: json.duration,
        },
      }));
    } catch (err) {
      setTryIt((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Erreur reseau",
      }));
    }
  }, [baseUrl, endpoint, tryIt.paramValues, tryIt.bodyValue]);

  return (
    <div className={`rounded-lg border ${style.border} overflow-hidden`}>
      {/* Header */}
      <button
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${style.bg} hover:opacity-90 transition-opacity`}
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
        )}
        <Badge
          className={`${style.badge} text-[11px] font-mono font-bold px-2.5 py-0.5 min-w-[4.5rem] text-center shrink-0`}
        >
          {endpoint.method}
        </Badge>
        <code className="text-sm font-mono flex-1 min-w-0 truncate">
          {endpoint.path}
        </code>
        {endpoint.summary && (
          <span className="text-xs text-muted-foreground truncate max-w-[40%] hidden sm:block">
            {endpoint.summary}
          </span>
        )}
        {endpoint.deprecated && (
          <Badge
            variant="outline"
            className="text-[10px] text-amber-600 border-amber-300 shrink-0"
          >
            <AlertTriangle className="h-3 w-3 mr-0.5" />
            Deprecie
          </Badge>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t px-4 py-4 space-y-4 bg-background">
          {/* Description */}
          {endpoint.description && (
            <p className="text-sm text-muted-foreground">
              {endpoint.description}
            </p>
          )}

          {/* Parameters */}
          {endpoint.params.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Parametres
              </h5>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 text-xs">
                      <th className="text-left px-3 py-1.5 font-medium">Nom</th>
                      <th className="text-left px-3 py-1.5 font-medium w-[70px]">In</th>
                      <th className="text-left px-3 py-1.5 font-medium w-[80px]">Type</th>
                      <th className="text-left px-3 py-1.5 font-medium hidden sm:table-cell">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.params.map((p, i) => (
                      <ParamRow key={i} param={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Request body */}
          {endpoint.requestBody && (
            <div>
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Corps de la requete
                <Badge variant="outline" className="text-[10px] ml-2 font-mono">
                  {endpoint.requestBody.contentType}
                </Badge>
              </h5>
              {endpoint.requestBody.description && (
                <p className="text-xs text-muted-foreground mb-1">
                  {endpoint.requestBody.description}
                </p>
              )}
              {endpoint.requestBody.schemaPreview && (
                <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto max-h-40 font-mono">
                  {endpoint.requestBody.schemaPreview}
                </pre>
              )}
            </div>
          )}

          {/* Responses */}
          {endpoint.responses.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Reponses
              </h5>
              <div className="flex flex-wrap gap-2">
                {endpoint.responses.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <StatusBadge code={r.code} />
                    {r.description && (
                      <span className="text-muted-foreground truncate max-w-[200px]">
                        {r.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Try It */}
          <div className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowTryIt(!showTryIt)}
            >
              <Play className="h-3 w-3" />
              {showTryIt ? "Masquer" : "Essayer"}
            </Button>

            {showTryIt && (
              <TryItForm
                endpoint={endpoint}
                baseUrl={baseUrl}
                state={tryIt}
                onParamChange={(name, value) =>
                  setTryIt((prev) => ({
                    ...prev,
                    paramValues: { ...prev.paramValues, [name]: value },
                  }))
                }
                onBodyChange={(value) =>
                  setTryIt((prev) => ({ ...prev, bodyValue: value }))
                }
                onExecute={executeTryIt}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ParamRow({ param }: { param: OpenApiParam }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-1.5 font-mono text-xs">
        {param.name}
        {param.required && <span className="text-red-500 ml-0.5">*</span>}
      </td>
      <td className="px-3 py-1.5">
        <Badge variant="outline" className="text-[10px] font-mono">
          {param.in}
        </Badge>
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground font-mono">
        {param.type}
        {param.enum && (
          <span className="block text-[10px] text-muted-foreground/60">
            [{param.enum.slice(0, 3).join(", ")}
            {param.enum.length > 3 ? "..." : ""}]
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground hidden sm:table-cell">
        {param.description || "-"}
        {param.example && (
          <span className="block text-[10px] text-muted-foreground/60">
            Ex: {param.example}
          </span>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ code }: { code: string }) {
  const num = parseInt(code);
  let color = "bg-muted text-muted-foreground";
  if (num >= 200 && num < 300) color = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
  else if (num >= 300 && num < 400) color = "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
  else if (num >= 400 && num < 500) color = "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
  else if (num >= 500) color = "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";

  return (
    <Badge className={`${color} text-[10px] font-mono px-1.5`}>
      {code}
    </Badge>
  );
}

function TryItForm({
  endpoint,
  baseUrl,
  state,
  onParamChange,
  onBodyChange,
  onExecute,
}: {
  endpoint: OpenApiEndpoint;
  baseUrl: string;
  state: TryItState;
  onParamChange: (name: string, value: string) => void;
  onBodyChange: (value: string) => void;
  onExecute: () => void;
}) {
  // Build preview URL
  let previewUrl = baseUrl + endpoint.path;
  for (const p of endpoint.params.filter((p) => p.in === "path")) {
    const val = state.paramValues[p.name] || `{${p.name}}`;
    previewUrl = previewUrl.replace(`{${p.name}}`, val);
  }
  const queryParts = endpoint.params
    .filter((p) => p.in === "query" && state.paramValues[p.name])
    .map((p) => `${p.name}=${encodeURIComponent(state.paramValues[p.name])}`);
  if (queryParts.length > 0) previewUrl += "?" + queryParts.join("&");

  return (
    <div className="mt-3 space-y-3">
      {/* URL preview */}
      <div className="flex items-center gap-2 rounded bg-muted/50 px-3 py-2">
        <Badge
          className={`${(METHOD_STYLES[endpoint.method] || DEFAULT_STYLE).badge} text-[10px] font-mono shrink-0`}
        >
          {endpoint.method}
        </Badge>
        <code className="text-[11px] font-mono text-muted-foreground truncate flex-1">
          {previewUrl}
        </code>
      </div>

      {/* Parameter inputs */}
      {endpoint.params.length > 0 && (
        <div className="space-y-2">
          {endpoint.params.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <label className="text-xs font-mono w-28 shrink-0 text-right">
                {p.name}
                {p.required && <span className="text-red-500">*</span>}
                <span className="text-[10px] text-muted-foreground/60 ml-1">
                  ({p.in})
                </span>
              </label>
              {p.enum ? (
                <select
                  className="flex-1 text-xs rounded border bg-background px-2 py-1.5"
                  value={state.paramValues[p.name] || ""}
                  onChange={(e) => onParamChange(p.name, e.target.value)}
                >
                  <option value="">-- Choisir --</option>
                  {p.enum.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  className="flex-1 h-8 text-xs font-mono"
                  placeholder={p.example || p.type}
                  value={state.paramValues[p.name] || ""}
                  onChange={(e) => onParamChange(p.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Request body */}
      {endpoint.requestBody && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Request Body
          </label>
          <Textarea
            className="mt-1 text-xs font-mono min-h-[80px]"
            value={state.bodyValue}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder='{"key": "value"}'
          />
        </div>
      )}

      {/* Execute button */}
      <Button
        size="sm"
        className="gap-1.5"
        onClick={onExecute}
        disabled={state.loading}
      >
        {state.loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        Envoyer
      </Button>

      {/* Error */}
      {state.error && (
        <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-400">
          {state.error}
        </div>
      )}

      {/* Response */}
      {state.response && (
        <div className="rounded border overflow-hidden">
          <div className="flex items-center gap-3 bg-muted/30 px-3 py-2 text-xs">
            <StatusBadge code={String(state.response.status)} />
            <span className="text-muted-foreground">
              {state.response.statusText}
            </span>
            <span className="ml-auto flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {state.response.duration}ms
            </span>
          </div>
          <pre className="p-3 text-[11px] font-mono overflow-x-auto max-h-80 bg-muted/10">
            {typeof state.response.body === "string"
              ? state.response.body
              : JSON.stringify(state.response.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
