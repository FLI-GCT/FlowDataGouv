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

const RES_COLS = 6;

const RES_PAGE_SIZE = 20;
const ENRICH_CONCURRENCY = 5;

export function DatasetDetail({ datasetId }: DatasetDetailProps) {
  const infoCall = useMcpCall<ParsedDataset>();
  const resourcesCall = useMcpCall<ParsedResourceList>();
  const metricsCall = useMcpCall<ParsedMetrics>();
  const [resourceDetails, setResourceDetails] = useState<Map<string, ResourceEnriched>>(new Map());
  const [visibleCount, setVisibleCount] = useState(RES_PAGE_SIZE);
  const enrichedRef = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    infoCall.call("get_dataset_info", { dataset_id: datasetId });
    resourcesCall.call("list_dataset_resources", { dataset_id: datasetId });
    metricsCall.call("get_metrics", { dataset_id: datasetId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  // Enrich resources with concurrency limit + batched state updates
  const enrichResources = useCallback(async (resources: ParsedResource[]) => {
    const toProcess = resources.filter((r) => !enrichedRef.current.has(r.id));
    if (toProcess.length === 0) return;

    // Non-previewable formats (ICS, PDF, ZIP…) don't need a tabular check.
    // Populate them immediately from list data to avoid unnecessary API calls.
    const immediate = new Map<string, ResourceEnriched>();
    const needApiCheck: ParsedResource[] = [];
    for (const res of toProcess) {
      enrichedRef.current.add(res.id);
      if (isPreviewableFormat(res.format?.toLowerCase() || "")) {
        needApiCheck.push(res);
      } else {
        immediate.set(res.id, { mime: res.mime, resourceType: res.resourceType });
      }
    }

    if (immediate.size > 0) {
      setResourceDetails((prev) => {
        const next = new Map(prev);
        for (const [k, v] of immediate) next.set(k, v);
        return next;
      });
    }

    if (needApiCheck.length === 0) return;

    const batch: Map<string, ResourceEnriched> = new Map();
    let pending = 0;
    let idx = 0;

    const flush = () => {
      if (batch.size > 0) {
        const snapshot = new Map(batch);
        batch.clear();
        setResourceDetails((prev) => {
          const next = new Map(prev);
          for (const [k, v] of snapshot) next.set(k, v);
          return next;
        });
      }
    };

    const processOne = async (res: ParsedResource) => {
      try {
        const response = await fetch("/api/datagouv/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "get_resource_info", args: { resource_id: res.id } }),
        });
        if (!response.ok) {
          batch.set(res.id, { mime: res.mime, resourceType: res.resourceType });
          return;
        }
        const json = await response.json();
        const parsed = json.result;
        if (parsed?.type === "resource") {
          batch.set(res.id, {
            mime: parsed.mime,
            resourceType: parsed.resourceType,
            tabularApiAvailable: parsed.tabularApiAvailable,
          });
        } else {
          batch.set(res.id, { mime: res.mime, resourceType: res.resourceType });
        }
      } catch {
        batch.set(res.id, { mime: res.mime, resourceType: res.resourceType });
      }
    };

    // Process previewable resources with concurrency limit
    await new Promise<void>((resolve) => {
      const next = () => {
        while (pending < ENRICH_CONCURRENCY && idx < needApiCheck.length) {
          pending++;
          const item = needApiCheck[idx++];
          processOne(item).finally(() => {
            pending--;
            if (batch.size >= ENRICH_CONCURRENCY) flush();
            if (pending === 0 && idx >= needApiCheck.length) {
              flush();
              resolve();
            } else {
              next();
            }
          });
        }
      };
      next();
    });
  }, []);

  // Enrich only visible resources when they change
  const allResources = resourcesCall.data?.type === "resource_list" ? resourcesCall.data.resources : [];
  const visibleResources = allResources.slice(0, visibleCount);

  useEffect(() => {
    if (visibleResources.length > 0) {
      enrichResources(visibleResources);
    }
  }, [visibleResources.length, enrichResources]); // eslint-disable-line react-hooks/exhaustive-deps

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
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleResources.map((res, i) => {
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
                            <TableCell className="font-medium text-sm py-2.5 max-w-0">
                              <div className="leading-snug truncate" title={res.title}>{res.title}</div>
                              {detail?.mime && (
                                <span className="text-[10px] text-muted-foreground/60 truncate block">{detail.mime}</span>
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
                            <TableCell className="py-2.5">
                              {res.id && (
                                <a href={`/api/download/${res.id}`} download onClick={(e) => e.stopPropagation()}>
                                  <Button variant="outline" size="icon" className="h-8 w-8 text-sky-700 border-sky-300 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-700 dark:hover:bg-sky-950" title="Telecharger">
                                    <Download className="h-4 w-4" />
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
                                    sizeBytes={res.sizeBytes}
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
              {visibleResources.map((res) => {
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
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2.5 font-medium text-sky-700 border-sky-300 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-700 dark:hover:bg-sky-950">
                                <Download className="h-3.5 w-3.5" /> DL
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
                          sizeBytes={res.sizeBytes}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Show more / show less */}
            {resources.resources.length > RES_PAGE_SIZE && (
              <div className="flex items-center justify-center gap-3 pt-3">
                {visibleCount < resources.resources.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setVisibleCount((c) => Math.min(c + RES_PAGE_SIZE, resources.resources.length))}
                  >
                    Voir plus ({Math.min(RES_PAGE_SIZE, resources.resources.length - visibleCount)} suivants)
                  </Button>
                )}
                {visibleCount > RES_PAGE_SIZE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setVisibleCount(RES_PAGE_SIZE)}
                  >
                    Reduire
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {visibleCount < resources.resources.length
                    ? `${visibleCount} / ${resources.resources.length}`
                    : `${resources.resources.length} affichees`}
                </span>
              </div>
            )}
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
  return [
    "csv", "tsv", "xlsx", "xls", "json", "jsonl", "geojson", "parquet", "xml",
    "pdf", "jpg", "jpeg", "png", "gif", "webp", "svg",
    "zip", "7z", "rar", "gz", "tar", "gtfs",
  ].includes(format);
}
