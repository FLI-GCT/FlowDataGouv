"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database,
  Globe,
  Layers,
  Eye,
  Download,
  RefreshCw,
  Trophy,
  BarChart3,
  MapPin,
  Clock,
  ArrowRight,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

export interface CatalogSummaryData {
  lastSync: string;
  stats: {
    totalDatasets: number;
    totalDataservices: number;
    totalCategories: number;
    totalTags: number;
    totalViews: number;
    totalDownloads: number;
    totalReuses: number;
    enrichedCount: number;
    enrichmentProgress: number;
  };
  categories: {
    slug: string;
    label: string;
    totalItems: number;
    color: string;
    description: string;
  }[];
  topDatasets: {
    id: string;
    title: string;
    organization: string;
    views: number;
    downloads: number;
    reuses: number;
  }[];
  categoryStats: {
    slug: string;
    label: string;
    color: string;
    totalViews: number;
    totalDownloads: number;
    totalReuses: number;
    totalItems: number;
  }[];
  geoRegions: {
    slug: string;
    label: string;
    scope: string;
    count: number;
  }[];
}

// ── Color map ────────────────────────────────────────────────────

const COLOR_MAP: Record<string, { dot: string; bar: string }> = {
  blue: { dot: "bg-blue-500", bar: "bg-blue-500" },
  emerald: { dot: "bg-emerald-500", bar: "bg-emerald-500" },
  violet: { dot: "bg-violet-500", bar: "bg-violet-500" },
  amber: { dot: "bg-amber-500", bar: "bg-amber-500" },
  rose: { dot: "bg-rose-500", bar: "bg-rose-500" },
  cyan: { dot: "bg-cyan-500", bar: "bg-cyan-500" },
  orange: { dot: "bg-orange-500", bar: "bg-orange-500" },
  indigo: { dot: "bg-indigo-500", bar: "bg-indigo-500" },
  teal: { dot: "bg-teal-500", bar: "bg-teal-500" },
  pink: { dot: "bg-pink-500", bar: "bg-pink-500" },
  lime: { dot: "bg-lime-500", bar: "bg-lime-500" },
  fuchsia: { dot: "bg-fuchsia-500", bar: "bg-fuchsia-500" },
  sky: { dot: "bg-sky-500", bar: "bg-sky-500" },
  red: { dot: "bg-red-500", bar: "bg-red-500" },
  green: { dot: "bg-green-500", bar: "bg-green-500" },
  slate: { dot: "bg-slate-500", bar: "bg-slate-500" },
  zinc: { dot: "bg-zinc-500", bar: "bg-zinc-500" },
  stone: { dot: "bg-stone-500", bar: "bg-stone-500" },
};

function getColor(name: string) {
  return COLOR_MAP[name] || COLOR_MAP.blue;
}

function formatBigNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("fr-FR");
}

// ── Main Component ───────────────────────────────────────────────

export function CatalogSummary({ initialData }: { initialData?: CatalogSummaryData | null }) {
  const router = useRouter();
  const [data, setData] = useState<CatalogSummaryData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return; // skip fetch when server-provided
    fetch("/api/catalog/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.stats) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initialData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2.5">
            <Layers className="h-6 w-6 text-violet-600" />
            Donnees ouvertes de l&apos;Etat
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data.stats.totalDatasets.toLocaleString("fr-FR")} datasets
            {" "}&middot;{" "}
            {data.stats.totalDataservices} APIs publiques
            {" "}&middot;{" "}
            {data.stats.totalTags.toLocaleString("fr-FR")} tags
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Synchronise le{" "}
          {new Date(data.lastSync).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Datasets" value={data.stats.totalDatasets} icon={<Database className="h-5 w-5 text-blue-500" />} color="bg-blue-50 dark:bg-blue-950/30" />
        <StatCard label="APIs" value={data.stats.totalDataservices} icon={<Globe className="h-5 w-5 text-violet-500" />} color="bg-violet-50 dark:bg-violet-950/30" />
        <StatCard label="Categories" value={data.stats.totalCategories} icon={<Layers className="h-5 w-5 text-amber-500" />} color="bg-amber-50 dark:bg-amber-950/30" />
        <StatCard label="Visites totales" value={data.stats.totalViews || 0} icon={<Eye className="h-5 w-5 text-emerald-500" />} color="bg-emerald-50 dark:bg-emerald-950/30" format />
        <StatCard label="Telechargements" value={data.stats.totalDownloads || 0} icon={<Download className="h-5 w-5 text-sky-500" />} color="bg-sky-50 dark:bg-sky-950/30" format />
        <StatCard label="Reutilisations" value={data.stats.totalReuses || 0} icon={<RefreshCw className="h-5 w-5 text-rose-500" />} color="bg-rose-50 dark:bg-rose-950/30" format />
      </div>

      {/* Top datasets + Category rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top datasets */}
        <Card className="p-5 border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20">
          <div className="flex items-center gap-2.5 mb-4">
            <Trophy className="h-5 w-5 text-amber-600" />
            <h3 className="text-base font-bold">Datasets les plus utilises</h3>
          </div>
          <div className="space-y-1">
            {data.topDatasets.slice(0, 10).map((ds, idx) => (
              <button
                key={ds.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/20 rounded-lg transition-colors group"
                onClick={() => router.push(`/explore/dataset/${ds.id}`)}
              >
                <span className={`text-sm font-bold tabular-nums shrink-0 w-6 text-center ${idx < 3 ? "text-amber-600" : "text-muted-foreground"}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                    {ds.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{ds.organization}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 tabular-nums">
                    <Eye className="h-3.5 w-3.5 text-emerald-500" />
                    {formatBigNumber(ds.views)}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Download className="h-3.5 w-3.5 text-sky-500" />
                    {formatBigNumber(ds.downloads)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Category rankings */}
        <Card className="p-5 border-sky-200 dark:border-sky-800 bg-gradient-to-br from-sky-50/60 to-transparent dark:from-sky-950/20">
          <div className="flex items-center gap-2.5 mb-4">
            <BarChart3 className="h-5 w-5 text-sky-600" />
            <h3 className="text-base font-bold">Thèmes les plus téléchargés</h3>
          </div>
          <div className="space-y-3">
            {[...data.categoryStats]
              .sort((a, b) => b.totalDownloads - a.totalDownloads)
              .slice(0, 8)
              .map((cat) => {
                const maxDl = Math.max(...data.categoryStats.map((c) => c.totalDownloads), 1);
                const pct = (cat.totalDownloads / maxDl) * 100;
                const color = getColor(cat.color);
                return (
                  <button
                    key={cat.slug}
                    className="w-full text-left hover:opacity-80 transition-opacity"
                    onClick={() => router.push(`/explore?category=${cat.slug}`)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${color.dot}`} />
                        <span className="text-sm font-medium truncate">{cat.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-2">
                        <span className="tabular-nums">{formatBigNumber(cat.totalDownloads)} DL</span>
                        <span className="tabular-nums hidden sm:inline">{formatBigNumber(cat.totalViews)} vues</span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color.bar} transition-all duration-500`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
          </div>
        </Card>
      </div>

      {/* Geographic regions */}
      {data.geoRegions.length > 0 && (
        <Card className="p-5 border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/20">
          <div className="flex items-center gap-2.5 mb-4">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <h3 className="text-base font-bold">Repartition geographique</h3>
            <Badge variant="secondary" className="text-xs ml-auto">
              Top {data.geoRegions.length} zones
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.geoRegions.map((region) => (
              <button
                key={region.slug}
                onClick={() => router.push(`/explore?geoScope=${region.scope}&geoArea=${encodeURIComponent(region.label)}`)}
                className="group"
              >
                <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5 group-hover:border-emerald-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950/30 transition-colors">
                  <span className={`inline-block px-1.5 py-0 rounded text-[10px] font-medium ${
                    region.scope === "communal" ? "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300" :
                    region.scope === "departemental" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                    region.scope === "regional" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                  }`}>
                    {region.scope === "communal" ? "Commune" :
                     region.scope === "departemental" ? "Departement" :
                     region.scope === "regional" ? "Region" : "National"}
                  </span>
                  {region.label}
                  <span className="text-muted-foreground">({region.count})</span>
                </Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Category chips — explore par theme */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2.5 shrink-0">
            <ArrowRight className="h-5 w-5 text-violet-600" />
            Explorer par theme
          </h2>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="flex flex-wrap gap-2">
          {data.categories.map((cat) => {
            const color = getColor(cat.color);
            return (
              <button
                key={cat.slug}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:shadow-md hover:border-primary/30 transition-all text-sm"
                onClick={() => router.push(`/explore?category=${cat.slug}`)}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
                <span className="font-medium">{cat.label}</span>
                <span className="text-muted-foreground text-xs">{cat.totalItems.toLocaleString("fr-FR")}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
  format,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  format?: boolean;
}) {
  return (
    <Card className={`p-4 ${color} border-0 shadow-sm`}>
      <div className="flex items-center gap-2.5 mb-2">
        {icon}
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">
        {format ? formatBigNumber(value) : value.toLocaleString("fr-FR")}
      </p>
    </Card>
  );
}
