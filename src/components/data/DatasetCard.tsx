"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Building2,
  FileText,
  ExternalLink,
  Calendar,
  Scale,
  RefreshCw,
} from "lucide-react";
import type { ParsedDataset } from "@/lib/parsers";

interface DatasetCardProps {
  dataset: ParsedDataset;
  compact?: boolean;
}

export function DatasetCard({ dataset, compact = false }: DatasetCardProps) {
  if (compact) {
    return (
      <Card className="group overflow-hidden transition-shadow hover:shadow-md">
        <a
          href={dataset.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 p-3"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium group-hover:text-primary">
              {dataset.title}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {dataset.organization && (
                <span className="flex items-center gap-1 truncate">
                  <Building2 className="h-3 w-3 shrink-0" />
                  {dataset.organization}
                </span>
              )}
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {dataset.resourceCount}
              </span>
            </div>
            {dataset.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {dataset.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {tag}
                  </Badge>
                ))}
                {dataset.tags.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{dataset.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            <Database className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <a
              href={dataset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold hover:text-primary hover:underline"
            >
              {dataset.title}
            </a>
            {dataset.organization && (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                {dataset.organization}
              </p>
            )}
          </div>
        </div>

        {dataset.description && (
          <p className="mt-3 text-sm text-muted-foreground line-clamp-3">
            {dataset.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {dataset.resourceCount} ressource{dataset.resourceCount > 1 ? "s" : ""}
          </span>
          {dataset.license && dataset.license !== "notspecified" && (
            <span className="flex items-center gap-1">
              <Scale className="h-3.5 w-3.5" />
              {dataset.license}
            </span>
          )}
          {dataset.frequency && dataset.frequency !== "unknown" && (
            <span className="flex items-center gap-1">
              <RefreshCw className="h-3.5 w-3.5" />
              {dataset.frequency}
            </span>
          )}
          {dataset.createdAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(dataset.createdAt).toLocaleDateString("fr-FR")}
            </span>
          )}
        </div>

        {dataset.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {dataset.tags.slice(0, 6).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {dataset.tags.length > 6 && (
              <Badge variant="outline" className="text-xs">
                +{dataset.tags.length - 6}
              </Badge>
            )}
          </div>
        )}

        <div className="mt-3">
          <a
            href={dataset.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Voir sur data.gouv.fr
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </Card>
  );
}
