"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Table2,
} from "lucide-react";
import type { ParsedTabularData } from "@/lib/parsers";

interface DataTableProps {
  data: ParsedTabularData;
  sourceFormat?: string;
}

const PAGE_SIZE = 10;

export function DataTable({ data, sourceFormat }: DataTableProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  // Filter columns: remove __id if present
  const columns = useMemo(
    () => data.columns.filter((c) => c !== "__id"),
    [data.columns]
  );

  // Filter rows
  const filteredRows = useMemo(() => {
    if (!filter) return data.rows;
    const lower = filter.toLowerCase();
    return data.rows.filter((row) =>
      Object.values(row).some((v) => v.toLowerCase().includes(lower))
    );
  }, [data.rows, filter]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortColumn) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = a[sortColumn] || "";
      const vb = b[sortColumn] || "";
      // Try numeric sort
      const na = parseFloat(va);
      const nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        return sortDir === "asc" ? na - nb : nb - na;
      }
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [filteredRows, sortColumn, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);
  const pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(col: string) {
    if (sortColumn === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
    setPage(0);
  }

  const isJsonSource = sourceFormat && ["json", "jsonl", "geojson"].includes(sourceFormat.toLowerCase());

  function exportCsv() {
    const header = columns.join(",");
    const csvRows = sortedRows.map((row) =>
      columns.map((col) => `"${(row[col] || "").replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.resourceTitle || "data"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    const jsonData = sortedRows.map((row) => {
      const obj: Record<string, string> = {};
      for (const col of columns) obj[col] = row[col] || "";
      return obj;
    });
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.resourceTitle || "data"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (data.rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
        <Table2 className="h-8 w-8" />
        <p className="text-sm">Aucune donnee a afficher</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with metadata */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {data.totalRows.toLocaleString("fr-FR")} ligne{data.totalRows > 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline">
            {columns.length} colonne{columns.length > 1 ? "s" : ""}
          </Badge>
          {data.hasMore && (
            <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">
              Extrait partiel
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filtrer..."
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              className="h-7 pl-7 text-xs w-40"
            />
          </div>
          {isJsonSource ? (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportJson}>
              <Download className="h-3 w-3" />
              JSON
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportCsv}>
              <Download className="h-3 w-3" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-auto max-h-96">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} className="whitespace-nowrap">
                  <button
                    onClick={() => handleSort(col)}
                    className="flex items-center gap-1 text-xs font-medium hover:text-foreground"
                  >
                    {col}
                    {sortColumn === col ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-30" />
                    )}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                    {row[col] || ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page + 1} / {totalPages}
            {filter && ` (${filteredRows.length} resultat${filteredRows.length > 1 ? "s" : ""})`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 w-6 p-0"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 w-6 p-0"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
