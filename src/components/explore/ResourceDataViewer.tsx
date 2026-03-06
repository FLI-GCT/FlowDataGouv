"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data/DataTable";
import { DataChart } from "@/components/data/DataChart";
import { JsonTreeViewer } from "@/components/data/JsonTreeViewer";
import { ImageViewer } from "@/components/data/ImageViewer";
import { PdfViewer } from "@/components/data/PdfViewer";
import { XmlViewer } from "@/components/data/XmlViewer";
import { ZipViewer } from "@/components/data/ZipViewer";
import {
  ChevronUp,
  Loader2,
  AlertTriangle,
  Eye,
  ExternalLink,
  Globe,
  FileCode2,
} from "lucide-react";
import type { ParsedTabularData } from "@/lib/parsers";

interface ResourceDataViewerProps {
  resourceId: string;
  resourceTitle: string;
  isTabular: boolean;
  format?: string;
  sizeBytes?: number;
  previewMaxBytes?: number;
}

type FormatGroup = "tabular" | "json" | "image" | "pdf" | "xml" | "zip" | "unknown";

const FORMAT_MAP: Record<string, FormatGroup> = {
  csv: "tabular", tsv: "tabular", xlsx: "tabular", xls: "tabular", parquet: "tabular",
  json: "json", jsonl: "json", geojson: "json",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image",
  pdf: "pdf",
  xml: "xml",
  zip: "zip", "7z": "zip", rar: "zip", gz: "zip", tar: "zip", gtfs: "zip",
};

function getFormatGroup(format?: string, isTabular?: boolean): FormatGroup {
  if (format) {
    const group = FORMAT_MAP[format.toLowerCase()];
    if (group) return group;
  }
  if (isTabular) return "tabular";
  return "unknown";
}

const DEFAULT_MAX_BYTES = parseInt(process.env.NEXT_PUBLIC_PREVIEW_MAX_MB || "50", 10) * 1024 * 1024;

export function ResourceDataViewer({
  resourceId,
  resourceTitle,
  isTabular,
  format,
  sizeBytes,
  previewMaxBytes = DEFAULT_MAX_BYTES,
}: ResourceDataViewerProps) {
  const [tabularData, setTabularData] = useState<ParsedTabularData | null>(null);
  const [jsonData, setJsonData] = useState<unknown>(null);
  const [jsonMeta, setJsonMeta] = useState<{ totalItems: number | null; displayedItems: number | null; truncated: boolean } | null>(null);
  const [zipData, setZipData] = useState<{ entries: { name: string; size: number; compressedSize: number; isDirectory: boolean }[]; totalFiles: number; totalSize: number } | null>(null);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const formatGroup = getFormatGroup(format, isTabular);

  useEffect(() => {
    if (!expanded || loaded) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function loadData() {
    // Image and PDF don't need a fetch — they use the download proxy directly
    if (formatGroup === "image" || formatGroup === "pdf") {
      setLoaded(true);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (formatGroup === "json") {
        // Use server-side JSON parsing with truncation
        const response = await fetch("/api/datagouv/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "download_resource_json",
            args: { resource_id: resourceId, max_items: 5 },
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || `Erreur HTTP ${response.status}`);
        }

        const json = await response.json();
        const result = json.result;
        setJsonData(result.data);
        setJsonMeta({ totalItems: result.totalItems, displayedItems: result.displayedItems, truncated: result.truncated });
      } else if (formatGroup === "zip") {
        const response = await fetch("/api/datagouv/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "list_zip_contents",
            args: { resource_id: resourceId },
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || `Erreur HTTP ${response.status}`);
        }

        const json = await response.json();
        const result = json.result;
        setZipData({ entries: result.entries, totalFiles: result.totalFiles, totalSize: result.totalSize });
      } else if (formatGroup === "xml") {
        const response = await fetch("/api/datagouv/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "download_resource_raw",
            args: { resource_id: resourceId },
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || `Erreur HTTP ${response.status}`);
        }

        const json = await response.json();
        setRawContent(json.result.content);
      } else {
        // Tabular data
        // Binary formats (xlsx, xls, parquet) require the tabular API — can't parse client-side
        const binaryFormats = ["xlsx", "xls", "parquet"];
        if (!isTabular && binaryFormats.includes((format || "").toLowerCase())) {
          throw new Error("Ce fichier binaire n'est pas disponible via l'API tabulaire. Telechargez-le directement.");
        }
        const tool = isTabular ? "query_resource_data" : "download_and_parse_resource";
        const response = await fetch("/api/datagouv/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool, args: { resource_id: resourceId } }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || `Erreur HTTP ${response.status}`);
        }

        const json = await response.json();
        const result = json.result;

        if (result?.type === "tabular_data") {
          setTabularData(result as ParsedTabularData);
        } else if (typeof result === "string") {
          // Don't display binary garbage
          // eslint-disable-next-line no-control-regex
          if (/[\x00-\x08\x0E-\x1F]/.test(result.substring(0, 200))) {
            throw new Error("Contenu binaire non previewable. Telechargez le fichier directement.");
          }
          setRawContent(result);
        }
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

  const binaryTabular = formatGroup === "tabular" && !isTabular && ["xlsx", "xls", "parquet"].includes((format || "").toLowerCase());
  const canPreview = !binaryTabular && (formatGroup !== "unknown" || isTabular || isPreviewableFormat(format));
  const tooLarge = sizeBytes != null && sizeBytes > previewMaxBytes;

  if (!canPreview || tooLarge) return null;

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
          {isLoading && (
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

          {/* Tabular viewer */}
          {tabularData && (
            <div className="space-y-3">
              <DataTable data={tabularData} sourceFormat={format} />
              <DataChart data={tabularData} />
            </div>
          )}

          {/* API documentation card (HTML mislabeled as JSON) */}
          {jsonData != null && typeof jsonData === "object" && !Array.isArray(jsonData) && (jsonData as Record<string, unknown>)._type === "html_api" && (
            <ApiDocCard data={jsonData as Record<string, string>} />
          )}

          {/* JSON tree viewer */}
          {jsonData != null && !(typeof jsonData === "object" && !Array.isArray(jsonData) && (jsonData as Record<string, unknown>)._type === "html_api") && (
            <JsonTreeViewer
              data={jsonData}
              totalItems={jsonMeta?.totalItems ?? null}
              displayedItems={jsonMeta?.displayedItems ?? null}
              truncated={jsonMeta?.truncated ?? false}
            />
          )}

          {/* Image viewer */}
          {formatGroup === "image" && loaded && (
            <ImageViewer resourceId={resourceId} resourceTitle={resourceTitle} />
          )}

          {/* PDF viewer */}
          {formatGroup === "pdf" && loaded && (
            <PdfViewer resourceId={resourceId} />
          )}

          {/* ZIP viewer */}
          {zipData && (
            <ZipViewer entries={zipData.entries} totalFiles={zipData.totalFiles} totalSize={zipData.totalSize} />
          )}

          {/* XML viewer */}
          {formatGroup === "xml" && rawContent && (
            <XmlViewer content={rawContent} />
          )}

          {/* Raw text fallback (non-XML, non-JSON) */}
          {rawContent && formatGroup !== "xml" && jsonData == null && (
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

function ApiDocCard({ data }: { data: Record<string, string> }) {
  return (
    <div className="rounded-lg border bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-blue-950/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        <span className="font-semibold text-sm text-indigo-900 dark:text-indigo-200">
          {data.framework || "API Web"}
        </span>
      </div>
      {data.title && (
        <p className="text-sm text-foreground/80">{data.title}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {data.url && (
          <a href={data.url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-white dark:bg-background">
              <ExternalLink className="h-3.5 w-3.5" />
              Ouvrir la documentation
            </Button>
          </a>
        )}
        {data.specUrl && (
          <a href={data.specUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-white dark:bg-background">
              <FileCode2 className="h-3.5 w-3.5" />
              Specification OpenAPI
            </Button>
          </a>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cette ressource est une documentation d&apos;API interactive, pas un fichier de donnees telechargeable.
      </p>
    </div>
  );
}

function isPreviewableFormat(format?: string): boolean {
  if (!format) return false;
  return format.toLowerCase() in FORMAT_MAP;
}
