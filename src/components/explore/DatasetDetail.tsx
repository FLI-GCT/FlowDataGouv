"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useMcpCall } from "@/hooks/useMcpCall";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricsChart } from "@/components/data/MetricsChart";
import { ResourceDataViewer } from "./ResourceDataViewer";
import {
  Calendar,
  Building2,
  FileText,
  Tag,
  ExternalLink,
  RefreshCw,
  Scale,
  Download,
  FileSpreadsheet,
  FileJson2,
  FileArchive,
  Database,
  BarChart3,
  CheckCircle2,
  Eye,
  Clock,
  Layers,
} from "lucide-react";
import type { ParsedDataset, ParsedResourceList, ParsedResource, ParsedMetrics } from "@/lib/parsers";

interface DatasetDetailProps {
  datasetId: string;
}

const FORMAT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  csv: { icon: FileSpreadsheet, color: "text-green-600" },
  xlsx: { icon: FileSpreadsheet, color: "text-green-600" },
  xls: { icon: FileSpreadsheet, color: "text-green-600" },
  json: { icon: FileJson2, color: "text-amber-600" },
  jsonl: { icon: FileJson2, color: "text-amber-600" },
  geojson: { icon: FileJson2, color: "text-amber-600" },
  zip: { icon: FileArchive, color: "text-purple-600" },
  parquet: { icon: Database, color: "text-sky-600" },
};

interface ResourceEnriched {
  mime?: string;
  resourceType?: string;
  tabularApiAvailable?: boolean;
}

const RES_COLS = 7;

export function DatasetDetail({ datasetId }: DatasetDetailProps) {
  const infoCall = useMcpCall<ParsedDataset>();
  const resourcesCall = useMcpCall<ParsedResourceList>();
  const metricsCall = useMcpCall<ParsedMetrics>();
  const [resourceDetails, setResourceDetails] = useState<Map<string, ResourceEnriched>>(new Map());

  useEffect(() => {
    infoCall.call("get_dataset_info", { dataset_id: datasetId });
    resourcesCall.call("list_dataset_resources", { dataset_id: datasetId });
    metricsCall.call("get_metrics", { dataset_id: datasetId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  // Enrich each resource with get_resource_info (REST direct)
  const enrichResources = useCallback(async (resources: ParsedResource[]) => {
    const promises = resources.map(async (res) => {
      try {
        const response = await fetch("/api/datagouv/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "get_resource_info", args: { resource_id: res.id } }),
        });
        if (!response.ok) return;
        const json = await response.json();
        const parsed = json.result;
        if (parsed?.type === "resource") {
          setResourceDetails((prev) => {
            const next = new Map(prev);
            next.set(res.id, {
              mime: parsed.mime,
              resourceType: parsed.resourceType,
              tabularApiAvailable: parsed.tabularApiAvailable,
            });
            return next;
          });
        }
      } catch {
        // skip
      }
    });
    await Promise.allSettled(promises);
  }, []);

  // Trigger enrichment when resources arrive
  useEffect(() => {
    if (resourcesCall.data?.type === "resource_list" && resourcesCall.data.resources.length > 0) {
      enrichResources(resourcesCall.data.resources);
    }
  }, [resourcesCall.data, enrichResources]);

  const info = infoCall.data;
  const resources = resourcesCall.data;
  const metrics = metricsCall.data;

  if (infoCall.isLoading && !info) {
    return (
      <div className="space-y-4 p-4 sm:p-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (infoCall.error) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {infoCall.error}
        </div>
      </div>
    );
  }

  if (!info || info.type !== "dataset") return null;

  return (
    <div className="space-y-8 p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">{info.title}</h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3 text-sm text-muted-foreground">
          {info.organization && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Building2 className="h-3 w-3" />
              {info.organization}
            </Badge>
          )}
          {info.license && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Scale className="h-3 w-3" />
              {info.license}
            </Badge>
          )}
          {info.frequency && (
            <Badge variant="outline" className="gap-1 text-xs">
              <RefreshCw className="h-3 w-3" />
              {info.frequency}
            </Badge>
          )}
          {info.lastModified && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Clock className="h-3 w-3" />
              MAJ : {info.lastModified.substring(0, 10)}
            </Badge>
          )}
          {info.createdAt && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Calendar className="h-3 w-3" />
              Cree : {info.createdAt.substring(0, 10)}
            </Badge>
          )}
        </div>
      </div>

      {/* Description */}
      {info.description && (
        <Card className="p-4">
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {info.description}
          </p>
        </Card>
      )}

      {/* Tags */}
      {info.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          {info.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Link */}
      {info.url && (
        <a href={info.url} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <ExternalLink className="h-3.5 w-3.5" />
            Voir sur data.gouv.fr
          </Button>
        </a>
      )}

      {/* Resources - Table layout */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Ressources
          {resources?.type === "resource_list" && (
            <Badge variant="outline" className="text-xs font-normal">
              {resources.total} fichier{resources.total > 1 ? "s" : ""}
            </Badge>
          )}
        </h2>

        {resourcesCall.isLoading && !resources && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}

        {resources?.type === "resource_list" && resources.resources.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block rounded-xl border shadow-sm">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-[36px]"></TableHead>
                      <TableHead>Nom</TableHead>
                      <TableHead className="w-[70px] text-center">Format</TableHead>
                      <TableHead className="w-[80px]">Taille</TableHead>
                      <TableHead className="w-[90px]">Type</TableHead>
                      <TableHead className="w-[130px]">Statut</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resources.resources.map((res, i) => {
                      const fmt = res.format?.toLowerCase() || "";
                      const fmtInfo = FORMAT_ICONS[fmt] || { icon: FileText, color: "text-muted-foreground" };
                      const FmtIcon = fmtInfo.icon;
                      const detail = resourceDetails.get(res.id);
                      const isTabular = detail?.tabularApiAvailable ?? res.tabularApiAvailable;
                      const isEnrichingRes = !detail;

                      return (
                        <React.Fragment key={res.id}>
                          <TableRow className={`transition-colors hover:bg-muted/30 ${i % 2 === 1 ? "bg-muted/15" : ""}`}>
                            <TableCell className="py-2.5">
                              <FmtIcon className={`h-4 w-4 ${fmtInfo.color}`} />
                            </TableCell>
                            <TableCell className="font-medium text-sm py-2.5">
                              <div className="leading-snug">{res.title}</div>
                              {detail?.mime && (
                                <span className="text-[10px] text-muted-foreground/60">{detail.mime}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center py-2.5">
                              <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                {res.format || "?"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground tabular-nums py-2.5">
                              {res.size || "-"}
                            </TableCell>
                            <TableCell className="text-sm py-2.5">
                              {isEnrichingRes ? (
                                <Skeleton className="h-4 w-14" />
                              ) : detail?.resourceType ? (
                                <Badge variant="secondary" className="text-[10px]">{detail.resourceType}</Badge>
                              ) : (
                                <span className="text-muted-foreground/40">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs py-2.5">
                              {isTabular && (
                                <span className="text-green-700 dark:text-green-400 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Interrogeable
                                </span>
                              )}
                              {!isTabular && isPreviewableFormat(fmt) && detail && (
                                <span className="text-sky-700 dark:text-sky-400 flex items-center gap-1">
                                  <Eye className="h-3 w-3" /> Apercu
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-2.5">
                              {res.id && (
                                <a href={`/api/download/${res.id}`} download onClick={(e) => e.stopPropagation()}>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Telecharger">
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>
                                </a>
                              )}
                            </TableCell>
                          </TableRow>
                          {/* Data viewer row */}
                          {(isTabular || isPreviewableFormat(fmt)) && !isEnrichingRes && (
                            <TableRow>
                              <TableCell colSpan={RES_COLS} className="p-0">
                                <div className="px-4 py-2 bg-muted/5">
                                  <ResourceDataViewer
                                    resourceId={res.id}
                                    resourceTitle={res.title}
                                    isTabular={!!isTabular}
                                    format={res.format}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-2">
              {resources.resources.map((res) => {
                const fmt = res.format?.toLowerCase() || "";
                const fmtInfo = FORMAT_ICONS[fmt] || { icon: FileText, color: "text-muted-foreground" };
                const FmtIcon = fmtInfo.icon;
                const detail = resourceDetails.get(res.id);
                const isTabular = detail?.tabularApiAvailable ?? res.tabularApiAvailable;
                const isEnrichingRes = !detail;

                return (
                  <div key={res.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start gap-2">
                      <FmtIcon className={`h-4 w-4 mt-0.5 shrink-0 ${fmtInfo.color}`} />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm leading-snug">{res.title}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {res.format || "?"}
                          </Badge>
                          {res.size && <span>{res.size}</span>}
                          {isEnrichingRes && <Skeleton className="h-3 w-12" />}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          {isTabular && (
                            <span className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Interrogeable
                            </span>
                          )}
                          {res.id && (
                            <a href={`/api/download/${res.id}`} download className="ml-auto">
                              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 px-2">
                                <Download className="h-3 w-3" /> DL
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    {(isTabular || isPreviewableFormat(fmt)) && !isEnrichingRes && (
                      <div className="mt-2 pt-2 border-t">
                        <ResourceDataViewer
                          resourceId={res.id}
                          resourceTitle={res.title}
                          isTabular={!!isTabular}
                          format={res.format}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Metriques d&apos;usage
        </h2>

        {metricsCall.isLoading && !metrics && (
          <Skeleton className="h-48 w-full" />
        )}

        {metrics?.type === "metrics" && <MetricsChart metrics={metrics} />}

        {metricsCall.error && (
          <p className="text-sm text-muted-foreground">
            Metriques non disponibles pour ce dataset.
          </p>
        )}
      </div>
    </div>
  );
}

function isPreviewableFormat(format: string): boolean {
  return ["csv", "tsv", "xlsx", "xls", "json", "jsonl", "geojson", "parquet", "xml"].includes(format);
}
