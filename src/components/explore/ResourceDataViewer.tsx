"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data/DataTable";
import { DataChart } from "@/components/data/DataChart";
import {
  ChevronUp,
  Loader2,
  AlertTriangle,
  Eye,
} from "lucide-react";
import type { ParsedTabularData } from "@/lib/parsers";

interface ResourceDataViewerProps {
  resourceId: string;
  resourceTitle: string;
  isTabular: boolean;
  format?: string;
}

export function ResourceDataViewer({
  resourceId,
  resourceTitle,
  isTabular,
  format,
}: ResourceDataViewerProps) {
  const [data, setData] = useState<ParsedTabularData | null>(null);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Auto-load data when expanded
  useEffect(() => {
    if (!expanded || loaded) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const tool = isTabular ? "query_resource_data" : "download_and_parse_resource";
      const args = isTabular
        ? { resource_id: resourceId }
        : { resource_id: resourceId };

      const response = await fetch("/api/datagouv/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Erreur HTTP ${response.status}`);
      }

      const json = await response.json();
      const result = json.result;

      if (result?.type === "tabular_data") {
        setData(result as ParsedTabularData);
      } else if (typeof result === "string") {
        setRawContent(result);
      }

      setLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      setError(message);
      setLoaded(true);
    } finally {
      setIsLoading(false);
    }
  }

  const canPreview = isTabular || isPreviewableFormat(format);

  if (!canPreview) return null;

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs w-full justify-start"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
        {expanded ? "Masquer les donnees" : "Visualiser les donnees"}
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />}
      </Button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {isLoading && !data && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Impossible de charger les donnees</p>
                <p className="mt-1 opacity-80">{error}</p>
              </div>
            </div>
          )}

          {data && (
            <div className="space-y-3">
              <DataTable data={data} sourceFormat={format} />
              <DataChart data={data} />
            </div>
          )}

          {rawContent && !data && (
            <div className="rounded-md border bg-muted/30 p-3 max-h-80 overflow-auto">
              <pre className="text-xs whitespace-pre-wrap font-mono">
                {rawContent.length > 5000
                  ? rawContent.substring(0, 5000) + "\n\n... (tronque)"
                  : rawContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Check if the format is something we can try to download & parse */
function isPreviewableFormat(format?: string): boolean {
  if (!format) return false;
  const f = format.toLowerCase();
  return ["csv", "tsv", "xlsx", "xls", "json", "jsonl", "geojson", "parquet", "xml"].includes(f);
}
