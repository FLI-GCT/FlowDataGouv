"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Eye,
  Download,
  Calendar,
  Building2,
} from "lucide-react";
import type { ParsedDataset } from "@/lib/parsers";

interface EnrichedInfo {
  lastModified?: string;
  license?: string;
  frequency?: string;
  description?: string;
  totalVisits?: number;
  totalDownloads?: number;
}

interface DatasetTableProps {
  datasets: ParsedDataset[];
  total: number;
  enriched?: Map<string, EnrichedInfo>;
}

type SortKey = "title" | "organization" | "resourceCount" | "lastModified" | "totalDownloads";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr.substring(0, 10);
  }
}

function formatNumber(n?: number): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("fr-FR");
}

export function DatasetTable({ datasets, total, enriched }: DatasetTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("lastModified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    return [...datasets].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = (a.title || "").localeCompare(b.title || "", "fr");
      } else if (sortKey === "organization") {
        cmp = (a.organization || "").localeCompare(b.organization || "", "fr");
      } else if (sortKey === "resourceCount") {
        cmp = (a.resourceCount || 0) - (b.resourceCount || 0);
      } else if (sortKey === "lastModified") {
        const aDate = enriched?.get(a.id)?.lastModified || a.lastModified || "";
        const bDate = enriched?.get(b.id)?.lastModified || b.lastModified || "";
        cmp = aDate.localeCompare(bDate);
      } else if (sortKey === "totalDownloads") {
        const aDl = enriched?.get(a.id)?.totalDownloads ?? 0;
        const bDl = enriched?.get(b.id)?.totalDownloads ?? 0;
        cmp = aDl - bDl;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [datasets, sortKey, sortDir, enriched]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const startIdx = page * PAGE_SIZE + 1;
  const endIdx = Math.min((page + 1) * PAGE_SIZE, sorted.length);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" || key === "organization" ? "asc" : "desc");
    }
    setPage(0);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );
  }

  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <FileText className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">Aucun dataset trouve</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border shadow-sm">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap w-auto"
                  onClick={() => toggleSort("title")}
                >
                  <span className="flex items-center gap-1">
                    Titre <SortIcon col="title" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap w-[160px]"
                  onClick={() => toggleSort("organization")}
                >
                  <span className="flex items-center gap-1">
                    Organisation <SortIcon col="organization" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap w-[70px] text-center"
                  onClick={() => toggleSort("resourceCount")}
                >
                  <span className="flex items-center gap-1 justify-center">
                    Fich. <SortIcon col="resourceCount" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap w-[120px]"
                  onClick={() => toggleSort("lastModified")}
                >
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> MAJ <SortIcon col="lastModified" />
                  </span>
                </TableHead>
                <TableHead className="whitespace-nowrap w-[80px]">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Visites
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap w-[80px]"
                  onClick={() => toggleSort("totalDownloads")}
                >
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" /> DL <SortIcon col="totalDownloads" />
                  </span>
                </TableHead>
                <TableHead className="whitespace-nowrap w-[140px]">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((ds, i) => {
                const extra = enriched?.get(ds.id);
                const isEnriching = enriched !== undefined && !extra;
                return (
                  <TableRow
                    key={ds.id}
                    className={`cursor-pointer transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/20 ${i % 2 === 1 ? "bg-muted/15" : ""}`}
                    onClick={() => router.push(`/explore/dataset/${ds.id}`)}
                  >
                    <TableCell className="font-medium py-3.5 min-w-0">
                      <div className="line-clamp-2 leading-snug text-[15px] text-blue-700 dark:text-blue-400 break-words" title={ds.title}>
                        {ds.title}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      <div className="line-clamp-1" title={ds.organization}>
                        {ds.organization || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm tabular-nums">
                      {ds.resourceCount || 0}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {isEnriching ? (
                        <Skeleton className="h-4 w-20" />
                      ) : extra?.lastModified ? (
                        formatDate(extra.lastModified)
                      ) : ds.lastModified ? (
                        formatDate(ds.lastModified)
                      ) : (
                        <span className="text-muted-foreground/40">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {isEnriching ? (
                        <Skeleton className="h-4 w-12" />
                      ) : extra?.totalVisits != null ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {formatNumber(extra.totalVisits)}
                        </span>
                      ) : extra ? (
                        <span className="text-muted-foreground/40">-</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {isEnriching ? (
                        <Skeleton className="h-4 w-12" />
                      ) : extra?.totalDownloads != null ? (
                        <span className="text-sky-700 dark:text-sky-400">
                          {formatNumber(extra.totalDownloads)}
                        </span>
                      ) : extra ? (
                        <span className="text-muted-foreground/40">-</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {ds.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs px-2 py-0.5">
                            {tag}
                          </Badge>
                        ))}
                        {ds.tags.length > 2 && (
                          <Badge variant="outline" className="text-xs px-2 py-0.5">
                            +{ds.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paged.map((ds) => {
          const extra = enriched?.get(ds.id);
          return (
            <div
              key={ds.id}
              className="rounded-lg border bg-card p-4 cursor-pointer hover:shadow-md transition-shadow active:bg-muted/30"
              onClick={() => router.push(`/explore/dataset/${ds.id}`)}
            >
              <h3 className="font-medium text-base text-blue-700 dark:text-blue-400 leading-snug">
                {ds.title}
              </h3>
              {ds.organization && (
                <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {ds.organization}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                {(extra?.lastModified || ds.lastModified) && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(extra?.lastModified || ds.lastModified)}
                  </span>
                )}
                {extra?.totalVisits != null && (
                  <span className="text-emerald-600 dark:text-emerald-400">{formatNumber(extra.totalVisits)} visites</span>
                )}
                {extra?.totalDownloads != null && (
                  <span className="text-sky-600 dark:text-sky-400">{formatNumber(extra.totalDownloads)} DL</span>
                )}
              </div>
              {ds.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {ds.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{startIdx}-{endIdx} sur {sorted.length} datasets</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2">Page {page + 1} / {totalPages}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
