"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Building2,
  ExternalLink,
  Link2,
  Calendar,
  FileCode2,
} from "lucide-react";
import type { ParsedDataservice } from "@/lib/parsers";

interface DataserviceCardProps {
  dataservice: ParsedDataservice;
  compact?: boolean;
}

export function DataserviceCard({ dataservice, compact = false }: DataserviceCardProps) {
  if (compact) {
    return (
      <Card className="group overflow-hidden transition-shadow hover:shadow-md">
        <a
          href={dataservice.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 p-3"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium group-hover:text-primary">
              {dataservice.title}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {dataservice.organization && (
                <span className="flex items-center gap-1 truncate">
                  <Building2 className="h-3 w-3 shrink-0" />
                  {dataservice.organization}
                </span>
              )}
            </div>
            {dataservice.baseApiUrl && (
              <p className="mt-0.5 flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 truncate">
                <Link2 className="h-2.5 w-2.5 shrink-0" />
                {dataservice.baseApiUrl}
              </p>
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
            <Globe className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <a
              href={dataservice.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold hover:text-primary hover:underline"
            >
              {dataservice.title}
            </a>
            {dataservice.organization && (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                {dataservice.organization}
              </p>
            )}
          </div>
        </div>

        {dataservice.description && (
          <p className="mt-3 text-sm text-muted-foreground line-clamp-3">
            {dataservice.description.replace(/[#>*`]/g, "").trim()}
          </p>
        )}

        {dataservice.baseApiUrl && (
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">
              <Link2 className="mr-1 h-3 w-3" />
              {dataservice.baseApiUrl}
            </Badge>
          </div>
        )}

        {dataservice.openapiSpecUrl && (
          <div className="mt-1.5">
            <a
              href={dataservice.openapiSpecUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              <FileCode2 className="h-3 w-3" />
              Specification OpenAPI
            </a>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {dataservice.createdAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(dataservice.createdAt).toLocaleDateString("fr-FR")}
            </span>
          )}
        </div>

        {dataservice.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {dataservice.tags.slice(0, 6).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {dataservice.tags.length > 6 && (
              <Badge variant="outline" className="text-xs">
                +{dataservice.tags.length - 6}
              </Badge>
            )}
          </div>
        )}

        <div className="mt-3">
          <a
            href={dataservice.url}
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
