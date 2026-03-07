"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Database,
  Globe,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  FolderOpen,
  TrendingUp,
  Eye,
  Download,
  RefreshCw,
  BarChart3,
  Trophy,
  MapPin,
  Sparkles,
} from "lucide-react";
import type {
  Catalog,
  CatalogCategory,
  CatalogSubCategory,
  CatalogSubSubCategory,
  CatalogItem,
  TopDataset,
  CategoryStats,
  GeoRegion,
} from "@/lib/sync/catalog";

// ── Color map ──────────────────────────────────────────────────────

const COLOR_MAP: Record<
  string,
  { border: string; text: string; badge: string; dot: string; subBg: string; bar: string }
> = {
  blue: { border: "border-l-blue-500", text: "text-blue-700 dark:text-blue-300", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", dot: "bg-blue-500", subBg: "bg-blue-50/50 dark:bg-blue-950/20", bar: "bg-blue-500" },
  emerald: { border: "border-l-emerald-500", text: "text-emerald-700 dark:text-emerald-300", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300", dot: "bg-emerald-500", subBg: "bg-emerald-50/50 dark:bg-emerald-950/20", bar: "bg-emerald-500" },
  violet: { border: "border-l-violet-500", text: "text-violet-700 dark:text-violet-300", badge: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300", dot: "bg-violet-500", subBg: "bg-violet-50/50 dark:bg-violet-950/20", bar: "bg-violet-500" },
  amber: { border: "border-l-amber-500", text: "text-amber-700 dark:text-amber-300", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", dot: "bg-amber-500", subBg: "bg-amber-50/50 dark:bg-amber-950/20", bar: "bg-amber-500" },
  rose: { border: "border-l-rose-500", text: "text-rose-700 dark:text-rose-300", badge: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300", dot: "bg-rose-500", subBg: "bg-rose-50/50 dark:bg-rose-950/20", bar: "bg-rose-500" },
  cyan: { border: "border-l-cyan-500", text: "text-cyan-700 dark:text-cyan-300", badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300", dot: "bg-cyan-500", subBg: "bg-cyan-50/50 dark:bg-cyan-950/20", bar: "bg-cyan-500" },
  orange: { border: "border-l-orange-500", text: "text-orange-700 dark:text-orange-300", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300", dot: "bg-orange-500", subBg: "bg-orange-50/50 dark:bg-orange-950/20", bar: "bg-orange-500" },
  indigo: { border: "border-l-indigo-500", text: "text-indigo-700 dark:text-indigo-300", badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300", dot: "bg-indigo-500", subBg: "bg-indigo-50/50 dark:bg-indigo-950/20", bar: "bg-indigo-500" },
  teal: { border: "border-l-teal-500", text: "text-teal-700 dark:text-teal-300", badge: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300", dot: "bg-teal-500", subBg: "bg-teal-50/50 dark:bg-teal-950/20", bar: "bg-teal-500" },
  pink: { border: "border-l-pink-500", text: "text-pink-700 dark:text-pink-300", badge: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300", dot: "bg-pink-500", subBg: "bg-pink-50/50 dark:bg-pink-950/20", bar: "bg-pink-500" },
  lime: { border: "border-l-lime-500", text: "text-lime-700 dark:text-lime-300", badge: "bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300", dot: "bg-lime-500", subBg: "bg-lime-50/50 dark:bg-lime-950/20", bar: "bg-lime-500" },
  fuchsia: { border: "border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300", badge: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300", dot: "bg-fuchsia-500", subBg: "bg-fuchsia-50/50 dark:bg-fuchsia-950/20", bar: "bg-fuchsia-500" },
  sky: { border: "border-l-sky-500", text: "text-sky-700 dark:text-sky-300", badge: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300", dot: "bg-sky-500", subBg: "bg-sky-50/50 dark:bg-sky-950/20", bar: "bg-sky-500" },
  red: { border: "border-l-red-500", text: "text-red-700 dark:text-red-300", badge: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", dot: "bg-red-500", subBg: "bg-red-50/50 dark:bg-red-950/20", bar: "bg-red-500" },
  green: { border: "border-l-green-500", text: "text-green-700 dark:text-green-300", badge: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", dot: "bg-green-500", subBg: "bg-green-50/50 dark:bg-green-950/20", bar: "bg-green-500" },
  slate: { border: "border-l-slate-500", text: "text-slate-700 dark:text-slate-300", badge: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300", dot: "bg-slate-500", subBg: "bg-slate-50/50 dark:bg-slate-950/20", bar: "bg-slate-500" },
  zinc: { border: "border-l-zinc-500", text: "text-zinc-700 dark:text-zinc-300", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300", dot: "bg-zinc-500", subBg: "bg-zinc-50/50 dark:bg-zinc-950/20", bar: "bg-zinc-500" },
  stone: { border: "border-l-stone-500", text: "text-stone-700 dark:text-stone-300", badge: "bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-300", dot: "bg-stone-500", subBg: "bg-stone-50/50 dark:bg-stone-950/20", bar: "bg-stone-500" },
};

const DEFAULT_COLOR = COLOR_MAP.blue;
function getColor(name: string) {
  return COLOR_MAP[name] || DEFAULT_COLOR;
}

function formatBigNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("fr-FR");
}

// ── Stats Overview ────────────────────────────────────────────────

function StatsOverview({ catalog }: { catalog: Catalog }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard
        label="Datasets"
        value={catalog.stats.totalDatasets}
        icon={<Database className="h-5 w-5 text-blue-500" />}
        color="bg-blue-50 dark:bg-blue-950/30"
      />
      <StatCard
        label="APIs"
        value={catalog.stats.totalDataservices}
        icon={<Globe className="h-5 w-5 text-violet-500" />}
        color="bg-violet-50 dark:bg-violet-950/30"
      />
      <StatCard
        label="Categories"
        value={catalog.stats.totalCategories}
        icon={<Layers className="h-5 w-5 text-amber-500" />}
        color="bg-amber-50 dark:bg-amber-950/30"
      />
      <StatCard
        label="Visites totales"
        value={catalog.stats.totalViews || 0}
        icon={<Eye className="h-5 w-5 text-emerald-500" />}
        color="bg-emerald-50 dark:bg-emerald-950/30"
        format
      />
      <StatCard
        label="Téléchargements"
        value={catalog.stats.totalDownloads || 0}
        icon={<Download className="h-5 w-5 text-sky-500" />}
        color="bg-sky-50 dark:bg-sky-950/30"
        format
      />
      <StatCard
        label="Reutilisations"
        value={catalog.stats.totalReuses || 0}
        icon={<RefreshCw className="h-5 w-5 text-rose-500" />}
        color="bg-rose-50 dark:bg-rose-950/30"
        format
      />
    </div>
  );
}

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
      <div className="flex items-center gap-2.5 mb-2">{icon}
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">
        {format ? formatBigNumber(value) : value.toLocaleString("fr-FR")}
      </p>
    </Card>
  );
}

// ── Top Datasets ─────────────────────────────────────────────────

function TopDatasetsSection({
  topDatasets,
  onDatasetClick,
}: {
  topDatasets: TopDataset[];
  onDatasetClick: (id: string) => void;
}) {
  if (!topDatasets || topDatasets.length === 0) return null;

  return (
    <Card className="p-5 border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20">
      <div className="flex items-center gap-2.5 mb-4">
        <Trophy className="h-5 w-5 text-amber-600" />
        <h3 className="text-base font-bold">Datasets les plus utilises</h3>
      </div>
      <div className="space-y-1">
        {topDatasets.slice(0, 10).map((ds, idx) => (
          <button
            key={ds.id}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/20 rounded-lg transition-colors group"
            onClick={() => onDatasetClick(ds.id)}
          >
            <span className={`text-sm font-bold tabular-nums shrink-0 w-6 text-center ${idx < 3 ? "text-amber-600" : "text-muted-foreground"}`}>
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                {ds.title}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {ds.organization}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 tabular-nums" title="Visites">
                <Eye className="h-3.5 w-3.5 text-emerald-500" />
                {formatBigNumber(ds.views)}
              </span>
              <span className="flex items-center gap-1 tabular-nums" title="Téléchargements">
                <Download className="h-3.5 w-3.5 text-sky-500" />
                {formatBigNumber(ds.downloads)}
              </span>
              {ds.reuses > 0 && (
                <span className="flex items-center gap-1 tabular-nums hidden sm:flex" title="Reutilisations">
                  <RefreshCw className="h-3.5 w-3.5 text-rose-500" />
                  {ds.reuses}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Category Rankings (bar chart-like) ───────────────────────────

function CategoryRankings({ categoryStats }: { categoryStats: CategoryStats[] }) {
  if (!categoryStats || categoryStats.length === 0) return null;

  const sortedByDownloads = [...categoryStats]
    .sort((a, b) => b.totalDownloads - a.totalDownloads)
    .slice(0, 8);

  const maxDl = Math.max(...sortedByDownloads.map((c) => c.totalDownloads), 1);

  return (
    <Card className="p-5 border-sky-200 dark:border-sky-800 bg-gradient-to-br from-sky-50/60 to-transparent dark:from-sky-950/20">
      <div className="flex items-center gap-2.5 mb-4">
        <BarChart3 className="h-5 w-5 text-sky-600" />
        <h3 className="text-base font-bold">Thèmes les plus téléchargés</h3>
      </div>
      <div className="space-y-3">
        {sortedByDownloads.map((cat) => {
          const color = getColor(cat.color);
          const pct = (cat.totalDownloads / maxDl) * 100;
          return (
            <div key={cat.slug}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${color.dot}`} />
                  <span className="text-sm font-medium truncate">{cat.label}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-2">
                  <span className="tabular-nums" title="Téléchargements">
                    {formatBigNumber(cat.totalDownloads)} DL
                  </span>
                  <span className="tabular-nums hidden sm:inline" title="Visites">
                    {formatBigNumber(cat.totalViews)} vues
                  </span>
                </div>
              </div>
              <div className="h-2.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${color.bar} transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Enrichment Progress ───────────────────────────────────────────

function EnrichmentProgress({ catalog }: { catalog: Catalog }) {
  const pct = catalog.stats.enrichmentProgress ?? 0;
  const enriched = catalog.stats.enrichedCount ?? 0;
  const total =
    catalog.stats.totalDatasets + catalog.stats.totalDataservices;

  if (pct >= 100 || total === 0) return null;

  return (
    <div className="rounded-lg border bg-gradient-to-r from-violet-50/80 to-amber-50/50 dark:from-violet-950/30 dark:to-amber-950/20 p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <span className="text-sm font-medium">
          Enrichissement IA en cours
        </span>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {enriched.toLocaleString("fr-FR")} / {total.toLocaleString("fr-FR")} ({pct}%)
        </span>
      </div>
      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-500 transition-all duration-700"
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        Chaque dataset est categorise, geolocalise et resume par Mistral AI.
        Relancez la synchronisation pour enrichir davantage.
      </p>
    </div>
  );
}

// ── Geographic Regions ────────────────────────────────────────────

function GeoRegionsSection({ regions }: { regions: GeoRegion[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!regions || regions.length === 0) return null;

  const displayed = showAll ? regions.slice(0, 50) : regions.slice(0, 12);
  const remaining = regions.length - displayed.length;

  const scopeLabels: Record<string, string> = {
    communal: "Commune",
    departemental: "Departement",
    regional: "Region",
    national: "National",
  };

  const scopeColors: Record<string, string> = {
    communal: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
    departemental: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    regional: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    national: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  };

  return (
    <Card className="p-5 border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/20">
      <div className="flex items-center gap-2.5 mb-4">
        <MapPin className="h-5 w-5 text-emerald-600" />
        <h3 className="text-base font-bold">Repartition geographique</h3>
        <Badge variant="secondary" className="text-xs ml-auto">
          {regions.length} zones
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {displayed.map((region) => (
          <Badge
            key={region.slug}
            variant="outline"
            className="text-xs px-2.5 py-1 gap-1.5"
          >
            <span
              className={`inline-block px-1.5 py-0 rounded text-[10px] font-medium ${
                scopeColors[region.scope] || scopeColors.national
              }`}
            >
              {scopeLabels[region.scope] || region.scope}
            </span>
            {region.label}
            <span className="text-muted-foreground">({region.count})</span>
          </Badge>
        ))}
      </div>
      {remaining > 0 && !showAll && (
        <button
          className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowAll(true)}
        >
          + {remaining} autres zones...
        </button>
      )}
    </Card>
  );
}

// ── Item row ───────────────────────────────────────────────────────

function ItemRow({ item, onClick }: { item: CatalogItem; onClick: () => void }) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted/40 rounded-md transition-colors"
      onClick={onClick}
    >
      {item.type === "dataset" ? (
        <Database className="h-3.5 w-3.5 text-blue-500 shrink-0" />
      ) : (
        <Globe className="h-3.5 w-3.5 text-violet-500 shrink-0" />
      )}
      <span className="text-sm truncate flex-1 min-w-0">{item.title}</span>
      <span className="text-xs text-muted-foreground shrink-0 max-w-[140px] truncate hidden lg:block opacity-60">
        {item.organization}
      </span>
    </button>
  );
}

// ── Sub-category block ─────────────────────────────────────────────

function Sub2GroupLabel({ group }: { group: CatalogSubSubCategory }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/60" />
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {group.label}
      </span>
      <span className="text-[10px] text-muted-foreground/50">({group.count})</span>
    </div>
  );
}

function SubCategoryBlock({
  subcat,
  colorClass,
  onItemClick,
}: {
  subcat: CatalogSubCategory;
  colorClass: string;
  onItemClick: (item: CatalogItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const dsCount = subcat.items.filter((i) => i.type === "dataset").length;
  const apiCount = subcat.items.filter((i) => i.type === "dataservice").length;
  const hasChildren = subcat.children && subcat.children.length > 1;

  // If we have level-3 children, group items by sub2
  const groupedItems = useMemo(() => {
    if (!hasChildren || !subcat.children) return null;
    const groups: { group: CatalogSubSubCategory; items: CatalogItem[] }[] = [];
    const itemsBySub2 = new Map<string, CatalogItem[]>();
    const ungrouped: CatalogItem[] = [];

    for (const item of subcat.items) {
      if (item.sub2) {
        if (!itemsBySub2.has(item.sub2)) itemsBySub2.set(item.sub2, []);
        itemsBySub2.get(item.sub2)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    for (const child of subcat.children) {
      const items = itemsBySub2.get(child.slug) || [];
      if (items.length > 0) {
        groups.push({ group: child, items });
        itemsBySub2.delete(child.slug);
      }
    }
    // Any remaining items that didn't match a child
    for (const [, items] of itemsBySub2) {
      ungrouped.push(...items);
    }
    if (ungrouped.length > 0) {
      groups.push({
        group: { slug: "autres", label: "Autres", count: ungrouped.length },
        items: ungrouped,
      });
    }

    return groups;
  }, [hasChildren, subcat.children, subcat.items]);

  const maxItems = showAll ? 25 : 3;

  return (
    <div className={`rounded-lg ${colorClass} px-3 py-2`}>
      {/* Sub-category header */}
      <div className="flex items-center gap-2 px-1 mb-1">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold flex-1 min-w-0 truncate">
          {subcat.label}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
          {hasChildren && (
            <span className="flex items-center gap-0.5" title="Sous-sous-categories">
              <Layers className="h-3 w-3" />
              {subcat.children!.length}
            </span>
          )}
          {dsCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Database className="h-3 w-3" />
              {dsCount}
            </span>
          )}
          {apiCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Globe className="h-3 w-3" />
              {apiCount}
            </span>
          )}
        </div>
      </div>

      {/* Items — grouped by sub2 if available */}
      {groupedItems ? (
        <>
          {groupedItems.slice(0, showAll ? undefined : 2).map(({ group, items }) => {
            const preview = items.slice(0, maxItems);
            return (
              <div key={group.slug}>
                <Sub2GroupLabel group={group} />
                {preview.map((item) => (
                  <ItemRow key={item.id} item={item} onClick={() => onItemClick(item)} />
                ))}
                {items.length > maxItems && !showAll && (
                  <div className="px-3 py-0.5 text-[10px] text-muted-foreground/60">
                    + {items.length - maxItems} dans ce groupe
                  </div>
                )}
              </div>
            );
          })}
          {!showAll && groupedItems.length > 2 && (
            <button
              className="w-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
              onClick={() => setShowAll(true)}
            >
              + {groupedItems.length - 2} autre{groupedItems.length - 2 > 1 ? "s" : ""} groupe{groupedItems.length - 2 > 1 ? "s" : ""}
              {" "}({subcat.items.length - groupedItems.slice(0, 2).reduce((s, g) => s + Math.min(g.items.length, maxItems), 0)} items)
            </button>
          )}
        </>
      ) : (
        <>
          {subcat.items.slice(0, maxItems).map((item) => (
            <ItemRow key={item.id} item={item} onClick={() => onItemClick(item)} />
          ))}
          {subcat.items.length > maxItems && !showAll && (
            <button
              className="w-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
              onClick={() => setShowAll(true)}
            >
              + {subcat.items.length - maxItems} autre{subcat.items.length - maxItems > 1 ? "s" : ""}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Category card ──────────────────────────────────────────────────

function CategoryCard({
  category,
  onItemClick,
}: {
  category: CatalogCategory;
  onItemClick: (item: CatalogItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = getColor(category.color);

  const previewSubcats = expanded
    ? category.subcategories
    : category.subcategories.slice(0, 2);

  return (
    <Card className={`overflow-hidden border-l-4 ${color.border}`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className={`text-base font-bold ${color.text}`}>
              {category.label}
            </h3>
            <Badge className={`${color.badge} text-xs px-2 py-0.5`}>
              {category.totalItems}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
            {category.description}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          {category.totalDatasets > 0 && (
            <span className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-blue-500" />
              {category.totalDatasets}
            </span>
          )}
          {category.totalDataservices > 0 && (
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-violet-500" />
              {category.totalDataservices}
            </span>
          )}
        </div>
      </button>

      {/* Collapsed: sub-category labels as chips + first 2 previews */}
      {!expanded && (
        <div className="border-t px-4 py-3 space-y-2.5">
          {category.subcategories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {category.subcategories.map((sc) => (
                <Badge
                  key={sc.slug}
                  variant="outline"
                  className="text-xs px-2 py-0.5"
                >
                  {sc.label}
                  <span className="ml-1 opacity-60">{sc.items.length}</span>
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {previewSubcats.map((sc) => (
              <SubCategoryBlock
                key={sc.slug}
                subcat={sc}
                colorClass={color.subBg}
                onItemClick={onItemClick}
              />
            ))}
          </div>

          {category.subcategories.length > 2 && (
            <button
              className="w-full py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors text-center border-t border-dashed"
              onClick={() => setExpanded(true)}
            >
              Voir les {category.subcategories.length - 2} autres sous-categories
            </button>
          )}
        </div>
      )}

      {/* Expanded: all sub-categories with items */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-2.5">
          {category.subcategories.map((sc) => (
            <SubCategoryBlock
              key={sc.slug}
              subcat={sc}
              colorClass={color.subBg}
              onItemClick={onItemClick}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Main component ─────────────────────────────────────────────────

export function CatalogBrowser() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/catalog");
        if (!res.ok) { setError(true); return; }
        const data = await res.json();
        if (data.categories) setCatalog(data);
        else setError(true);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleItemClick = (item: CatalogItem) => {
    if (item.type === "dataset") router.push(`/explore/dataset/${item.id}`);
    else router.push(`/explore/api/${item.id}`);
  };

  const handleDatasetClick = (id: string) => {
    router.push(`/explore/dataset/${id}`);
  };

  const catNav = useMemo(
    () =>
      catalog?.categories.map((c) => ({
        slug: c.slug,
        label: c.label,
        count: c.totalItems,
        color: getColor(c.color),
      })) || [],
    [catalog]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !catalog) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2.5">
            <Layers className="h-6 w-6 text-violet-600" />
            Donnees ouvertes de l&apos;Etat
          </h2>
          <p className="text-base text-muted-foreground mt-1">
            Vue d&apos;ensemble de {catalog.stats.totalDatasets.toLocaleString("fr-FR")} datasets
            {" "}&middot;{" "}
            {catalog.stats.totalDataservices} APIs publiques
            {" "}&middot;{" "}
            {catalog.stats.totalTags.toLocaleString("fr-FR")} tags
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Synchronise le{" "}
          {new Date(catalog.lastSync).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Enrichment progress */}
      <EnrichmentProgress catalog={catalog} />

      {/* Global Stats */}
      <StatsOverview catalog={catalog} />

      {/* Trends: Top Datasets + Category Rankings + Geo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TopDatasetsSection
          topDatasets={catalog.topDatasets || []}
          onDatasetClick={handleDatasetClick}
        />
        <CategoryRankings categoryStats={catalog.categoryStats || []} />
      </div>

      {/* Geographic regions */}
      <GeoRegionsSection regions={catalog.geoRegions || []} />

      {/* Section divider */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold flex items-center gap-2.5 shrink-0">
          <TrendingUp className="h-5 w-5 text-violet-600" />
          Explorer par categorie
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Quick nav */}
      <div className="flex flex-wrap gap-2">
        {catNav.map((c) => (
          <Button
            key={c.slug}
            variant="ghost"
            size="sm"
            className="h-8 text-xs px-3 gap-2"
            onClick={() =>
              document
                .getElementById(`cat-${c.slug}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <span className={`h-2.5 w-2.5 rounded-full ${c.color.dot}`} />
            {c.label}
            <span className="text-muted-foreground">{c.count}</span>
          </Button>
        ))}
      </div>

      {/* Category grid */}
      <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {catalog.categories.map((cat) => (
          <div key={cat.slug} id={`cat-${cat.slug}`}>
            <CategoryCard category={cat} onItemClick={handleItemClick} />
          </div>
        ))}
      </div>
    </div>
  );
}
