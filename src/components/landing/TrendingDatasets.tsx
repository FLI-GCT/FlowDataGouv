"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Eye, Download, Building2 } from "lucide-react";

interface TrendingDataset {
  id: string;
  title: string;
  organization: string;
  category: string;
  visits: number;
  downloads: number;
}

interface TrendingData {
  period: string;
  sort: string;
  datasets: TrendingDataset[];
}

const PERIODS = [
  { key: "month", label: "Ce mois" },
  { key: "last-month", label: "Mois dernier" },
  { key: "3months", label: "3 mois" },
] as const;

const SORTS = [
  { key: "visits", label: "Consultations", icon: Eye },
  { key: "downloads", label: "Telechargements", icon: Download },
] as const;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("fr-FR");
}

const MEDALS = ["text-amber-500", "text-slate-400", "text-amber-700"];

export function TrendingDatasets() {
  const [period, setPeriod] = useState<string>("month");
  const [sort, setSort] = useState<string>("visits");
  const [data, setData] = useState<TrendingData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trending?period=${period}&sort=${sort}&limit=15`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (json.datasets) setData(json);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [period, sort]);

  useEffect(() => {
    fetchTrending();
  }, [fetchTrending]);

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Tendances</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Period toggle */}
          <div className="inline-flex rounded-lg border bg-muted/50 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  period === p.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Sort toggle */}
          <div className="inline-flex rounded-lg border bg-muted/50 p-0.5">
            {SORTS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    sort === s.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : data?.datasets?.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.datasets.map((d, i) => (
            <Link
              key={d.id}
              href={`/explore/dataset/${d.id}`}
              className="flex items-start gap-3 rounded-lg border bg-card p-3 hover:border-primary/30 transition-colors"
            >
              {/* Rank */}
              <span
                className={`shrink-0 text-sm font-bold tabular-nums w-5 text-right ${
                  i < 3 ? MEDALS[i] : "text-muted-foreground/50"
                }`}
              >
                {i + 1}
              </span>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight truncate">{d.title}</p>
                <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{d.organization || "—"}</span>
                </div>
              </div>

              {/* Metric */}
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold tabular-nums">
                  {formatNumber(sort === "downloads" ? d.downloads : d.visits)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {sort === "downloads" ? "DL" : "vues"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          Donnees de tendances non disponibles pour cette periode.
        </p>
      )}
    </section>
  );
}
