"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  FileSpreadsheet,
  FileJson,
  FileArchive,
  File,
  Download,
  ExternalLink,
  Database,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { ParsedResource } from "@/lib/parsers";

const FORMAT_ICONS: Record<string, React.ElementType> = {
  csv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  json: FileJson,
  jsonl: FileJson,
  geojson: FileJson,
  zip: FileArchive,
  gz: FileArchive,
  parquet: Database,
};

const FORMAT_COLORS: Record<string, string> = {
  csv: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400",
  xls: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400",
  xlsx: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400",
  json: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  jsonl: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  geojson: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  zip: "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400",
  parquet: "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400",
};

interface ResourceCardProps {
  resource: ParsedResource;
  compact?: boolean;
}

export function ResourceCard({ resource, compact = false }: ResourceCardProps) {
  const fmt = resource.format.toLowerCase();
  const Icon = FORMAT_ICONS[fmt] || File;
  const colorClass = FORMAT_COLORS[fmt] || "bg-gray-50 text-gray-600 dark:bg-gray-950 dark:text-gray-400";

  if (compact) {
    return (
      <Card className="group overflow-hidden transition-shadow hover:shadow-md">
        <div className="flex items-center gap-3 p-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{resource.title}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px] uppercase px-1.5 py-0">
                {resource.format}
              </Badge>
              {resource.size && <span>{resource.size}</span>}
            </div>
          </div>
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            title="Telecharger"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{resource.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="uppercase">
                {resource.format}
              </Badge>
              {resource.size && <span>{resource.size}</span>}
              {resource.mime && <span className="text-muted-foreground/60">{resource.mime}</span>}
            </div>
          </div>
        </div>

        {resource.tabularApiAvailable !== undefined && (
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {resource.tabularApiAvailable ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span className="text-green-700 dark:text-green-400">
                  Interrogeable via Tabular API
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Non disponible via Tabular API
                </span>
              </>
            )}
          </div>
        )}

        {resource.datasetTitle && (
          <p className="mt-2 text-xs text-muted-foreground">
            <FileText className="mr-1 inline h-3 w-3" />
            {resource.datasetTitle}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Download className="h-3 w-3" />
            Telecharger
          </a>
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Ouvrir
          </a>
        </div>
      </div>
    </Card>
  );
}
