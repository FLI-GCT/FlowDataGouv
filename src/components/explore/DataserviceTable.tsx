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
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Calendar,
  Building2,
} from "lucide-react";
import type { ParsedDataservice } from "@/lib/parsers";

interface DataserviceTableProps {
  dataservices: ParsedDataservice[];
  total: number;
}

type SortKey = "title" | "organization";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 15;

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

export function DataserviceTable({ dataservices, total }: DataserviceTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    return [...dataservices].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = (a.title || "").localeCompare(b.title || "", "fr");
      } else if (sortKey === "organization") {
        cmp = (a.organization || "").localeCompare(b.organization || "", "fr");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [dataservices, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const startIdx = page * PAGE_SIZE + 1;
  const endIdx = Math.min((page + 1) * PAGE_SIZE, sorted.length);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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

  if (dataservices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Globe className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">Aucune API trouvee</p>
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
                <TableHead className="whitespace-nowrap w-[200px]">URL Base</TableHead>
                <TableHead className="whitespace-nowrap w-[120px]">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Creee le
                  </span>
                </TableHead>
                <TableHead className="whitespace-nowrap w-[140px]">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((ds, i) => (
                <TableRow
                  key={ds.id}
                  className={`cursor-pointer transition-colors hover:bg-violet-50/50 dark:hover:bg-violet-950/20 ${i % 2 === 1 ? "bg-muted/15" : ""}`}
                  onClick={() => router.push(`/explore/api/${ds.id}`)}
                >
                  <TableCell className="font-medium py-3.5 min-w-0">
                    <div className="line-clamp-2 leading-snug text-[15px] text-violet-700 dark:text-violet-400 break-words" title={ds.title}>
                      {ds.title}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    <div className="line-clamp-1" title={ds.organization}>
                      {ds.organization || "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {ds.baseApiUrl ? (
                      <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded block truncate max-w-[200px]" title={ds.baseApiUrl}>
                        {ds.baseApiUrl}
                      </code>
                    ) : (
                      <span className="text-muted-foreground/40">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {ds.createdAt ? formatDate(ds.createdAt) : "-"}
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
              ))}
            </TableBody>
          </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paged.map((ds) => (
          <div
            key={ds.id}
            className="rounded-lg border bg-card p-4 cursor-pointer hover:shadow-md transition-shadow active:bg-muted/30"
            onClick={() => router.push(`/explore/api/${ds.id}`)}
          >
            <h3 className="font-medium text-base text-violet-700 dark:text-violet-400 leading-snug">
              {ds.title}
            </h3>
            {ds.organization && (
              <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                {ds.organization}
              </p>
            )}
            {ds.baseApiUrl && (
              <code className="text-xs bg-muted px-2 py-1 rounded mt-2 block truncate">
                {ds.baseApiUrl}
              </code>
            )}
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
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{startIdx}-{endIdx} sur {sorted.length} APIs</span>
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
