"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Play,
  Copy,
  Check,
  Clock,
  Loader2,
  Globe,
  Terminal,
  Code2,
  FileDown,
  Zap,
  ChevronDown,
  AlertTriangle,
  Server,
  Download,
} from "lucide-react";
import type { OpenApiEndpoint } from "@/lib/parsers";

interface ApiExplorerProps {
  baseUrl: string;
  title: string;
  endpoints?: OpenApiEndpoint[];
}

interface ProbeResult {
  status: number;
  statusText: string;
  contentType: string;
  isJson: boolean;
  isFile: boolean;
  body: unknown;
  duration: number;
  headers: Record<string, string>;
  fileSize?: string;
}

interface RequestResult {
  status: number;
  statusText: string;
  body: unknown;
  duration: number;
  headers: Record<string, string>;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-600 text-white",
  POST: "bg-blue-600 text-white",
  PUT: "bg-amber-600 text-white",
  DELETE: "bg-red-600 text-white",
  PATCH: "bg-violet-600 text-white",
};

function StatusBadge({ code }: { code: number }) {
  let color = "bg-muted text-muted-foreground";
  if (code >= 200 && code < 300)
    color =
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
  else if (code >= 300 && code < 400)
    color =
      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
  else if (code >= 400 && code < 500)
    color =
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
  else if (code >= 500)
    color =
      "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";

  return (
    <Badge className={`${color} text-[10px] font-mono px-1.5`}>{code}</Badge>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={copy}
      title="Copier"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}

export function ApiExplorer({ baseUrl, title, endpoints }: ApiExplorerProps) {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeLoading, setProbeLoading] = useState(true);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Request builder
  const [selectedEndpoint, setSelectedEndpoint] = useState<OpenApiEndpoint | null>(null);
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const [requestResult, setRequestResult] = useState<RequestResult | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);

  // Snippets tab
  const [activeTab, setActiveTab] = useState<"curl" | "python" | "js">("curl");

  // Endpoint dropdown
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const cleanBase = baseUrl.replace(/\/+$/, "");

  // Detect if URL looks like a direct file
  const looksLikeFile = useMemo(() => {
    const lower = cleanBase.toLowerCase();
    return (
      lower.endsWith(".zip") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".gz") ||
      lower.endsWith(".xml") ||
      lower.endsWith(".json") ||
      lower.endsWith(".geojson") ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".pdf") ||
      lower.includes("/download")
    );
  }, [cleanBase]);

  // Derive API root from file URL (strip filename)
  const apiRoot = useMemo(() => {
    if (looksLikeFile) {
      const idx = cleanBase.lastIndexOf("/");
      return idx > 8 ? cleanBase.substring(0, idx) : cleanBase;
    }
    return cleanBase;
  }, [cleanBase, looksLikeFile]);

  // Auto-probe the base URL on mount
  useEffect(() => {
    (async () => {
      setProbeLoading(true);
      setProbeError(null);
      try {
        const res = await fetch("/api/dataservice/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanBase, method: "GET" }),
        });
        const json = await res.json();

        if (json.error) {
          setProbeError(json.error);
          setProbe(null);
        } else {
          const ct = json.headers?.["content-type"] || "";
          const cl = json.headers?.["content-length"];
          setProbe({
            status: json.status,
            statusText: json.statusText,
            contentType: ct,
            isJson: ct.includes("json"),
            isFile:
              ct.includes("zip") ||
              ct.includes("octet") ||
              ct.includes("csv") ||
              ct.includes("xml") ||
              ct.includes("gtfs") ||
              ct.includes("gzip") ||
              ct.includes("pdf") ||
              ct.includes("image/") ||
              looksLikeFile,
            body: json.body,
            duration: json.duration,
            headers: json.headers || {},
            fileSize: cl
              ? `${(parseInt(cl) / 1024 / 1024).toFixed(1)} Mo`
              : undefined,
          });
        }
      } catch {
        setProbe(null);
        setProbeError("Erreur de connexion au proxy");
      } finally {
        setProbeLoading(false);
      }
    })();
  }, [cleanBase, looksLikeFile]);

  // When user selects an endpoint from dropdown, populate fields
  const selectEndpoint = useCallback(
    (ep: OpenApiEndpoint | null) => {
      setSelectedEndpoint(ep);
      setDropdownOpen(false);
      setRequestResult(null);
      if (ep) {
        setMethod(ep.method.toUpperCase());
        setPath(ep.path);
        // Pre-fill params with examples
        const vals: Record<string, string> = {};
        for (const p of ep.params) {
          if (p.example) vals[p.name] = p.example;
          else if (p.enum && p.enum.length > 0) vals[p.name] = p.enum[0];
          else vals[p.name] = "";
        }
        setParamValues(vals);
        setBodyText("");
      } else {
        setMethod("GET");
        setPath("");
        setParamValues({});
        setBodyText("");
      }
    },
    []
  );

  // Build the full URL with params substituted
  const buildFullUrl = useCallback(() => {
    let builtPath = path;
    const queryParams: string[] = [];

    if (selectedEndpoint) {
      for (const p of selectedEndpoint.params) {
        const val = paramValues[p.name] || "";
        if (p.in === "path" && val) {
          builtPath = builtPath.replace(`{${p.name}}`, encodeURIComponent(val));
        } else if (p.in === "query" && val) {
          queryParams.push(
            `${encodeURIComponent(p.name)}=${encodeURIComponent(val)}`
          );
        }
      }
    }

    const base = selectedEndpoint ? apiRoot : cleanBase;
    const sep = builtPath.startsWith("/") ? "" : "/";
    const qs = queryParams.length > 0 ? "?" + queryParams.join("&") : "";
    return `${base}${builtPath ? sep + builtPath : ""}${qs}`;
  }, [path, selectedEndpoint, paramValues, apiRoot, cleanBase]);

  const fullUrl = buildFullUrl();

  const sendRequest = useCallback(async () => {
    setRequestLoading(true);
    setRequestResult(null);
    try {
      const res = await fetch("/api/dataservice/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: fullUrl,
          method: method,
          ...(bodyText && ["POST", "PUT", "PATCH"].includes(method)
            ? { body: JSON.parse(bodyText) }
            : {}),
        }),
      });
      const json = await res.json();
      setRequestResult({
        status: json.status,
        statusText: json.statusText,
        body: json.body,
        duration: json.duration,
        headers: json.headers || {},
      });
    } catch (err) {
      setRequestResult({
        status: 0,
        statusText: "Erreur reseau",
        body: err instanceof Error ? err.message : "Erreur",
        duration: 0,
        headers: {},
      });
    } finally {
      setRequestLoading(false);
    }
  }, [fullUrl, method, bodyText]);

  // Code snippets
  const snippets = useMemo(() => {
    const curlBody =
      method !== "GET" && bodyText
        ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyText}'`
        : "";
    return {
      curl:
        method === "GET"
          ? `curl -s "${fullUrl}" | head -c 2000`
          : `curl -s -X ${method} "${fullUrl}"${curlBody}`,
      python: `import requests

response = requests.${method.toLowerCase()}("${fullUrl}"${method !== "GET" && bodyText ? `,\n    json=${bodyText}` : ""})
print(response.status_code)
print(response.json())  # ou response.text`,
      js: `const response = await fetch("${fullUrl}"${method !== "GET" ? `, {\n  method: "${method}"${bodyText ? `,\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${bodyText})` : ""}\n}` : ""});
const data = await response.json();
console.log(data);`,
    };
  }, [fullUrl, method, bodyText]);

  // Group endpoints by tag
  const endpointsByTag = useMemo(() => {
    if (!endpoints || endpoints.length === 0) return null;
    const map = new Map<string, OpenApiEndpoint[]>();
    for (const ep of endpoints) {
      const tag = ep.tags[0] || "Endpoints";
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag)!.push(ep);
    }
    return map;
  }, [endpoints]);

  const hasEndpoints = endpoints && endpoints.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 border px-4 py-3">
        <Globe className="h-4 w-4 text-violet-600 shrink-0" />
        <code className="text-sm font-mono flex-1 min-w-0 truncate">
          {cleanBase}
        </code>
        <CopyButton text={cleanBase} />
      </div>

      {/* Diagnostic */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20">
          <Zap className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Diagnostic automatique</h3>
        </div>

        {probeLoading && (
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {!probeLoading && probeError && (
          <div className="p-4">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{probeError}</span>
            </div>
          </div>
        )}

        {!probeLoading && !probeError && probe && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Status:</span>
                <StatusBadge code={probe.status} />
                <span className="text-muted-foreground text-xs">
                  {probe.statusText}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {probe.duration}ms
                </span>
              </div>
              {probe.contentType && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {probe.contentType.split(";")[0]}
                </Badge>
              )}
              {probe.fileSize && (
                <Badge variant="outline" className="text-[10px]">
                  {probe.fileSize}
                </Badge>
              )}
              {probe.headers.server && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Server className="h-3 w-3" />
                  {probe.headers.server}
                </div>
              )}
            </div>

            {/* File detection */}
            {probe.isFile && (
              <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-2.5">
                <FileDown className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-medium">
                    Fichier telechargeable detecte
                  </span>
                  <p className="text-xs opacity-80">
                    Cette URL pointe vers un fichier ({probe.contentType.split(";")[0]}
                    {probe.fileSize ? `, ${probe.fileSize}` : ""}).
                    Utilisez le lien direct pour le telecharger.
                  </p>
                  <a
                    href={cleanBase}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium underline"
                  >
                    <Download className="h-3 w-3" />
                    Telecharger le fichier
                  </a>
                </div>
              </div>
            )}

            {/* JSON API detection */}
            {probe.isJson && !probe.isFile && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded p-2.5">
                <Code2 className="h-4 w-4 shrink-0" />
                <span>API JSON detectee — explorez les endpoints ci-dessous.</span>
              </div>
            )}

            {/* Response preview */}
            {probe.status >= 200 && probe.status < 400 && !probe.isFile && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Apercu de la reponse :
                </p>
                <pre className="text-[11px] font-mono bg-muted/30 rounded p-3 overflow-x-auto max-h-48 border">
                  {typeof probe.body === "string"
                    ? probe.body.substring(0, 2000)
                    : JSON.stringify(probe.body, null, 2)?.substring(0, 2000)}
                </pre>
              </div>
            )}

            {probe.status === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Impossible de joindre l&apos;API (CORS, timeout ou serveur
                inaccessible).
              </div>
            )}
          </div>
        )}

        {!probeLoading && !probeError && !probe && (
          <div className="p-4 text-sm text-muted-foreground">
            Impossible de tester l&apos;API.
          </div>
        )}
      </Card>

      {/* Endpoint tester */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20">
          <Play className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">
            Tester l&apos;API
          </h3>
          {hasEndpoints && (
            <Badge variant="secondary" className="text-[10px] ml-1">
              {endpoints.length} endpoint{endpoints.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Endpoint selector dropdown */}
          {hasEndpoints && (
            <div className="relative">
              <Button
                variant="outline"
                className="w-full justify-between h-auto py-2 px-3 text-left"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                {selectedEndpoint ? (
                  <span className="flex items-center gap-2 text-xs font-mono min-w-0">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${METHOD_COLORS[selectedEndpoint.method.toUpperCase()] || "bg-muted"}`}
                    >
                      {selectedEndpoint.method.toUpperCase()}
                    </span>
                    <span className="truncate">{selectedEndpoint.path}</span>
                    {selectedEndpoint.summary && (
                      <span className="text-muted-foreground truncate hidden sm:inline">
                        — {selectedEndpoint.summary}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Choisir un endpoint...
                  </span>
                )}
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>

              {dropdownOpen && (
                <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto bg-background border rounded-lg shadow-lg">
                  {/* Free form option */}
                  <button
                    className="w-full px-3 py-2 text-left text-xs hover:bg-muted/50 border-b"
                    onClick={() => selectEndpoint(null)}
                  >
                    <span className="text-muted-foreground">
                      Saisie libre (URL personnalisee)
                    </span>
                  </button>

                  {endpointsByTag &&
                    Array.from(endpointsByTag.entries()).map(
                      ([tag, eps]) => (
                        <div key={tag}>
                          <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 sticky top-0">
                            {tag}
                          </div>
                          {eps.map((ep, i) => (
                            <button
                              key={`${ep.method}-${ep.path}-${i}`}
                              className={`w-full px-3 py-2 text-left hover:bg-muted/50 flex items-center gap-2 ${
                                selectedEndpoint === ep ? "bg-muted/30" : ""
                              }`}
                              onClick={() => selectEndpoint(ep)}
                            >
                              <span
                                className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${METHOD_COLORS[ep.method.toUpperCase()] || "bg-muted"}`}
                              >
                                {ep.method.toUpperCase()}
                              </span>
                              <span className="text-xs font-mono truncate">
                                {ep.path}
                              </span>
                              {ep.summary && (
                                <span className="text-[10px] text-muted-foreground truncate ml-auto hidden sm:inline">
                                  {ep.summary}
                                </span>
                              )}
                              {ep.deprecated && (
                                <Badge
                                  variant="outline"
                                  className="text-[8px] text-amber-600 border-amber-300 shrink-0"
                                >
                                  deprecated
                                </Badge>
                              )}
                            </button>
                          ))}
                        </div>
                      )
                    )}
                </div>
              )}
            </div>
          )}

          {/* Parameter fields when endpoint selected */}
          {selectedEndpoint &&
            selectedEndpoint.params.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Parametres
                </p>
                <div className="grid gap-2">
                  {selectedEndpoint.params.map((p) => (
                    <div
                      key={p.name}
                      className="flex items-center gap-2"
                    >
                      <div className="flex items-center gap-1.5 min-w-[140px] shrink-0">
                        <code className="text-xs font-mono">
                          {p.name}
                        </code>
                        {p.required && (
                          <span className="text-red-500 text-xs">*</span>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[8px] py-0"
                        >
                          {p.in}
                        </Badge>
                      </div>
                      {p.enum && p.enum.length > 0 ? (
                        <select
                          className="flex-1 h-8 text-xs rounded-md border bg-background px-2 font-mono"
                          value={paramValues[p.name] || ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [p.name]: e.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          {p.enum.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          className="flex-1 h-8 text-xs font-mono"
                          placeholder={
                            p.description ||
                            p.example ||
                            `${p.type || "string"}`
                          }
                          value={paramValues[p.name] || ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [p.name]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Request body for POST/PUT/PATCH */}
          {selectedEndpoint &&
            ["POST", "PUT", "PATCH"].includes(
              selectedEndpoint.method.toUpperCase()
            ) && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Body (JSON)
                </p>
                <textarea
                  className="w-full h-24 text-xs font-mono rounded-md border bg-background px-3 py-2 resize-y"
                  placeholder='{"key": "value"}'
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                />
              </div>
            )}

          {/* URL bar + send */}
          <div className="flex gap-2">
            <div className="flex items-center gap-0 flex-1 rounded-lg border bg-background overflow-hidden">
              <select
                className="text-xs bg-muted/50 px-2 py-2 border-r font-mono shrink-0 h-9"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                disabled={!!selectedEndpoint}
              >
                {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {!selectedEndpoint && (
                <>
                  <span className="text-xs text-muted-foreground px-2 font-mono shrink-0 truncate max-w-[200px] hidden md:block">
                    {cleanBase}
                  </span>
                  <Input
                    className="border-0 h-9 text-xs font-mono rounded-none focus-visible:ring-0 flex-1"
                    placeholder="/endpoint?param=value"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendRequest();
                    }}
                  />
                </>
              )}
              {selectedEndpoint && (
                <span className="text-xs font-mono px-3 py-2 text-muted-foreground truncate flex-1">
                  {fullUrl}
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={sendRequest}
              disabled={requestLoading}
            >
              {requestLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Envoyer
            </Button>
          </div>

          {/* Resolved URL preview */}
          {selectedEndpoint && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-mono truncate">{fullUrl}</span>
              <CopyButton text={fullUrl} />
            </div>
          )}

          {!hasEndpoints && !selectedEndpoint && (
            <p className="text-[10px] text-muted-foreground">
              Ajoutez un chemin apres l&apos;URL de base. Ex:{" "}
              <code className="bg-muted px-1 rounded">/api/v1/status</code>,{" "}
              <code className="bg-muted px-1 rounded">/?format=json</code>
            </p>
          )}

          {/* Response */}
          {requestResult && (
            <div className="rounded border overflow-hidden">
              <div className="flex items-center gap-3 bg-muted/30 px-3 py-2 text-xs">
                <StatusBadge code={requestResult.status} />
                <span className="text-muted-foreground">
                  {requestResult.statusText}
                </span>
                <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {requestResult.duration}ms
                </span>
                <CopyButton
                  text={
                    typeof requestResult.body === "string"
                      ? requestResult.body
                      : JSON.stringify(requestResult.body, null, 2) || ""
                  }
                />
              </div>
              <pre className="p-3 text-[11px] font-mono overflow-x-auto max-h-80 bg-muted/10">
                {typeof requestResult.body === "string"
                  ? requestResult.body.substring(0, 5000)
                  : JSON.stringify(requestResult.body, null, 2)?.substring(
                      0,
                      5000
                    )}
              </pre>
            </div>
          )}
        </div>
      </Card>

      {/* Code snippets */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20">
          <Terminal className="h-4 w-4 text-blue-500" />
          <h3 className="text-sm font-semibold">Exemples de code</h3>
          <div className="ml-auto flex gap-1">
            {(["curl", "python", "js"] as const).map((tab) => (
              <Button
                key={tab}
                variant={activeTab === tab ? "secondary" : "ghost"}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setActiveTab(tab)}
              >
                {tab === "curl"
                  ? "cURL"
                  : tab === "python"
                    ? "Python"
                    : "JavaScript"}
              </Button>
            ))}
          </div>
        </div>
        <div className="relative">
          <pre className="p-4 text-[11px] font-mono overflow-x-auto bg-zinc-950 text-zinc-100 dark:bg-zinc-900">
            {snippets[activeTab]}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={snippets[activeTab]} />
          </div>
        </div>
      </Card>
    </div>
  );
}
