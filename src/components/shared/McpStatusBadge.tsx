"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity, AlertTriangle, Loader2, Wifi, WifiOff } from "lucide-react";

interface McpStatus {
  online: boolean;
  latency?: number;
  toolCount?: number;
  error?: string;
  checkedAt: string;
}

/**
 * Shared fetch helper — the server caches the result for 60s,
 * so multiple components/pages hitting this cost nothing extra.
 */
async function fetchMcpStatus(): Promise<McpStatus> {
  try {
    const res = await fetch("/api/mcp/status");
    return await res.json();
  } catch {
    return {
      online: false,
      error: "Impossible de verifier le statut",
      checkedAt: new Date().toISOString(),
    };
  }
}

export function McpStatusBadge() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMcpStatus().then((s) => {
      setStatus(s);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Verification de data.gouv.fr...</span>
      </div>
    );
  }

  if (!status) return null;

  if (status.online) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        <Wifi className="h-3 w-3" />
        <span>
          data.gouv.fr en ligne
          {status.latency != null && (
            <span className="ml-1 opacity-70">({status.latency}ms)</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
      title={status.error || "data.gouv.fr hors ligne"}
    >
      <span className="relative flex h-2 w-2">
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <WifiOff className="h-3 w-3" />
      <span>data.gouv.fr hors ligne</span>
    </div>
  );
}

/**
 * Expanded status card with more details, for embedding in a page section.
 */
export function McpStatusCard() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await fetchMcpStatus();
    setStatus(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Statut de data.gouv.fr</span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          {loading ? "Verification..." : "Rafraichir"}
        </button>
      </div>

      <div className="mt-3">
        {loading && !status ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verification en cours...
          </div>
        ) : status?.online ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
              </span>
              <span className="text-sm font-medium text-green-700 dark:text-green-400">
                En ligne
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              {status.latency != null && (
                <div>Latence : {status.latency}ms</div>
              )}
              {status.toolCount != null && (
                <div>{status.toolCount} outils disponibles</div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              <span className="text-sm font-medium text-red-700 dark:text-red-400">
                Hors ligne
              </span>
            </div>
            {status?.error && (
              <div className="flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{status.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {status?.checkedAt && (
        <div className="mt-2 text-[10px] text-muted-foreground/60">
          Derniere verification :{" "}
          {new Date(status.checkedAt).toLocaleTimeString("fr-FR")}
        </div>
      )}
    </div>
  );
}
