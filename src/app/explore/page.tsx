"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Search, Loader2, SlidersHorizontal, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { ResultCard } from "@/components/explore/ResultCard";
import { FacetPanel, type FacetFilters, type FacetCounts } from "@/components/explore/FacetPanel";
import { ActiveFilters, type ActiveFilter } from "@/components/explore/ActiveFilters";
import { ResultsToolbar } from "@/components/explore/ResultsToolbar";
import type { SearchExpansion } from "@/lib/search/expand";

// ── Types ────────────────────────────────────────────────────────

interface SearchResultItem {
  id: string;
  title: string;
  organization: string;
  type: "dataset" | "dataservice";
  summary: string;
  category: string;
  categoryLabel: string;
  subcategory: string;
  geoScope: string;
  geoArea: string;
  tags: string[];
  views: number;
  downloads: number;
  reuses: number;
  lastModified: string;
  license: string;
  quality: number;
  score?: number;
}

interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: FacetCounts;
  expansion?: SearchExpansion;
}

// ── Label maps ───────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  environnement: "Environnement",
  "transport-mobilite": "Transport",
  sante: "Sante",
  "education-recherche": "Education",
  "economie-emploi": "Economie",
  "logement-urbanisme": "Logement",
  "agriculture-alimentation": "Agriculture",
  "culture-patrimoine": "Culture",
  "justice-securite": "Justice",
  "collectivites-administration": "Collectivites",
  "finances-fiscalite": "Finances",
  "geographie-cartographie": "Geographie",
  energie: "Energie",
  "social-solidarite": "Social",
  "tourisme-loisirs-sport": "Tourisme",
  "numerique-technologie": "Numerique",
  "elections-democratie": "Elections",
  divers: "Divers",
};

const GEO_LABELS: Record<string, string> = {
  national: "National",
  regional: "Regional",
  departemental: "Departemental",
  communal: "Communal",
};

const TYPE_LABELS: Record<string, string> = { dataset: "Datasets", dataservice: "APIs" };

const LICENSE_LABELS: Record<string, string> = {
  lov2: "Licence Ouverte v2",
  notspecified: "Non specifiee",
  "fr-lo": "Licence Ouverte v1",
  "odc-odbl": "ODbL",
  "cc-by": "CC-BY",
};

const EMPTY_FILTERS: FacetFilters = {
  categories: [],
  subcategories: [],
  geoScopes: [],
  geoAreas: [],
  types: [],
  licenses: [],
  dateAfter: undefined,
  qualityMin: undefined,
};

const EMPTY_FACETS: FacetCounts = {
  categories: [],
  subcategories: [],
  geoScopes: [],
  geoAreas: [],
  types: [],
  licenses: [],
};

// ── URL params helpers ───────────────────────────────────────────

function filtersFromParams(params: URLSearchParams): FacetFilters {
  const qm = params.get("qualityMin");
  return {
    categories: params.getAll("category"),
    subcategories: params.getAll("subcategory"),
    geoScopes: params.getAll("geoScope"),
    geoAreas: params.getAll("geoArea"),
    types: params.getAll("type") as ("dataset" | "dataservice")[],
    licenses: params.getAll("license"),
    dateAfter: params.get("dateAfter") || undefined,
    qualityMin: qm ? parseInt(qm, 10) : undefined,
  };
}

function filtersToParams(query: string, filters: FacetFilters, sort: string, page: number): URLSearchParams {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  for (const c of filters.categories) p.append("category", c);
  for (const s of filters.subcategories) p.append("subcategory", s);
  for (const g of filters.geoScopes) p.append("geoScope", g);
  for (const a of filters.geoAreas) p.append("geoArea", a);
  for (const t of filters.types) p.append("type", t);
  for (const l of filters.licenses) p.append("license", l);
  if (filters.dateAfter) p.set("dateAfter", filters.dateAfter);
  if (filters.qualityMin) p.set("qualityMin", String(filters.qualityMin));
  if (sort && sort !== "downloads") p.set("sort", sort);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hasAnyFilter(f: FacetFilters): boolean {
  return f.categories.length + f.subcategories.length + f.geoScopes.length + f.geoAreas.length + f.types.length + f.licenses.length > 0
    || !!f.dateAfter || !!f.qualityMin;
}

const DATE_PILL_LABELS: Record<string, string> = {
  "7": "7 derniers jours",
  "30": "30 derniers jours",
  "90": "3 derniers mois",
  "365": "Derniere annee",
};

const QUALITY_PILL_LABELS: Record<number, string> = {
  2: "Qualite 2+",
  3: "Qualite 3+",
  4: "Qualite 4+",
};

function datePillLabel(dateAfter: string): string {
  const diffDays = Math.round((Date.now() - new Date(dateAfter).getTime()) / (24 * 60 * 60 * 1000));
  for (const [d, label] of Object.entries(DATE_PILL_LABELS)) {
    if (Math.abs(diffDays - parseInt(d)) <= 1) return label;
  }
  return `Depuis ${new Date(dateAfter).toLocaleDateString("fr-FR")}`;
}

function activeFiltersList(filters: FacetFilters): ActiveFilter[] {
  const list: ActiveFilter[] = [];
  for (const c of filters.categories) list.push({ key: c, group: "categories", label: CATEGORY_LABELS[c] || c });
  for (const s of filters.subcategories) list.push({ key: s, group: "subcategories", label: s });
  for (const g of filters.geoScopes) list.push({ key: g, group: "geoScopes", label: GEO_LABELS[g] || g });
  for (const a of filters.geoAreas) list.push({ key: a, group: "geoAreas", label: a });
  for (const t of filters.types) list.push({ key: t, group: "types", label: TYPE_LABELS[t] || t });
  for (const l of filters.licenses) list.push({ key: l, group: "licenses", label: LICENSE_LABELS[l] || l });
  if (filters.dateAfter) list.push({ key: "dateAfter", group: "dateAfter", label: datePillLabel(filters.dateAfter) });
  if (filters.qualityMin) list.push({ key: "qualityMin", group: "qualityMin", label: QUALITY_PILL_LABELS[filters.qualityMin] || `Qualite ${filters.qualityMin}+` });
  return list;
}

/** Merge Mistral-suggested filters into existing filters (without duplicates) */
function mergeFilters(current: FacetFilters, suggested: SearchExpansion["suggestedFilters"]): FacetFilters {
  if (!suggested) return current;
  const merged = { ...current };

  if (suggested.categories?.length) {
    const newCats = suggested.categories.filter((c) => !current.categories.includes(c));
    if (newCats.length > 0) merged.categories = [...current.categories, ...newCats];
  }
  if (suggested.geoScopes?.length) {
    const newScopes = suggested.geoScopes.filter((g) => !current.geoScopes.includes(g));
    if (newScopes.length > 0) merged.geoScopes = [...current.geoScopes, ...newScopes];
  }
  if (suggested.geoAreas?.length) {
    const newAreas = suggested.geoAreas.filter((a) => !current.geoAreas.includes(a));
    if (newAreas.length > 0) merged.geoAreas = [...current.geoAreas, ...newAreas];
  }
  return merged;
}

// ── CorrectionBanner ─────────────────────────────────────────────

function CorrectionBanner({
  original,
  corrected,
  onSearchOriginal,
}: {
  original: string;
  corrected: string;
  onSearchOriginal: () => void;
}) {
  if (original.toLowerCase() === corrected.toLowerCase()) return null;

  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-2.5 flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
      <span>
        <span className="line-through text-muted-foreground/60">{original}</span>
        {" "}
        <span className="font-medium">{corrected}</span>
      </span>
      <button
        className="text-xs text-muted-foreground hover:text-foreground underline ml-auto shrink-0"
        onClick={onSearchOriginal}
      >
        Rechercher &quot;{original}&quot;
      </button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

function ExploreContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = searchParams.get("q") || "";
  const initialSort = searchParams.get("sort") || "";
  const initialPage = parseInt(searchParams.get("page") || "1", 10);
  const initialFilters = filtersFromParams(searchParams);

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<FacetFilters>(initialFilters);
  const [sort, setSort] = useState(initialSort || (initialQuery ? "relevance" : "downloads"));
  const [page, setPage] = useState(initialPage);

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<FacetCounts>(EMPTY_FACETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Correction info (shown if Mistral corrected the query)
  const [correction, setCorrection] = useState<{ original: string; corrected: string } | null>(null);

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const initialLoadDone = useRef(false);

  // ── Search function ──────────────────────────────────────────

  const doSearch = useCallback(
    async (q: string, f: FacetFilters, s: string, p: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      const urlParams = filtersToParams(q, f, s, p);
      const urlStr = urlParams.toString();
      router.replace(`/explore${urlStr ? `?${urlStr}` : ""}`, { scroll: false });

      try {
        const res = await fetch("/api/catalog/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q || undefined,
            categories: f.categories.length > 0 ? f.categories : undefined,
            subcategories: f.subcategories.length > 0 ? f.subcategories : undefined,
            geoScopes: f.geoScopes.length > 0 ? f.geoScopes : undefined,
            geoAreas: f.geoAreas.length > 0 ? f.geoAreas : undefined,
            types: f.types.length > 0 ? f.types : undefined,
            licenses: f.licenses.length > 0 ? f.licenses : undefined,
            dateAfter: f.dateAfter || undefined,
            qualityMin: f.qualityMin || undefined,
            sort: s,
            page: p,
            pageSize: 20,
          }),
          signal: controller.signal,
        });

        if (res.status === 429) throw new Error("quota");
        if (!res.ok) throw new Error("Erreur de recherche");
        const data: SearchResponse = await res.json();
        if (controller.signal.aborted) return;

        setResults(data.items);
        setTotal(data.total);
        setFacets(data.facets);

        // Handle correction display
        if (data.expansion?.wasExpanded && data.expansion.original.toLowerCase() !== data.expansion.corrected.toLowerCase()) {
          setCorrection({ original: data.expansion.original, corrected: data.expansion.corrected });
        } else {
          setCorrection(null);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.message === "quota") {
          setError("Limite de 100 recherches par 24h atteinte. Réessayez demain.");
        } else {
          setError("Erreur lors de la recherche. Reessayez.");
        }
        console.error("[explore] Search error:", err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [router]
  );

  /**
   * Submit a new query: first call search without filters to get Mistral expansion,
   * then auto-apply suggested filters and re-search with those filters.
   */
  const handleSubmit = useCallback(
    async (e?: React.FormEvent, forceQuery?: string) => {
      if (e) e.preventDefault();
      const q = (forceQuery ?? query).trim();
      setSubmittedQuery(q);
      const newSort = q ? "relevance" : "downloads";
      setSort(newSort);
      setPage(1);

      if (!q) {
        // Empty query: reset everything
        setFilters(EMPTY_FILTERS);
        setCorrection(null);
        doSearch("", EMPTY_FILTERS, "downloads", 1);
        return;
      }

      // First pass: search with no user filters to get Mistral expansion
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/catalog/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, sort: newSort, page: 1, pageSize: 20 }),
          signal: controller.signal,
        });

        if (res.status === 429) throw new Error("quota");
        if (!res.ok) throw new Error("Erreur de recherche");
        const data: SearchResponse = await res.json();
        if (controller.signal.aborted) return;

        // Auto-apply suggested filters from Mistral
        let autoFilters = EMPTY_FILTERS;
        if (data.expansion?.suggestedFilters) {
          autoFilters = mergeFilters(EMPTY_FILTERS, data.expansion.suggestedFilters);
        }

        // If Mistral suggested filters, re-search with them applied
        const hasAutoFilters = hasAnyFilter(autoFilters);
        if (hasAutoFilters) {
          setFilters(autoFilters);

          // Handle correction display
          if (data.expansion?.wasExpanded && data.expansion.original.toLowerCase() !== data.expansion.corrected.toLowerCase()) {
            setCorrection({ original: data.expansion.original, corrected: data.expansion.corrected });
          } else {
            setCorrection(null);
          }

          // URL update + re-search with filters
          doSearch(q, autoFilters, newSort, 1);
        } else {
          // No suggested filters, use results as-is
          setFilters(EMPTY_FILTERS);
          setResults(data.items);
          setTotal(data.total);
          setFacets(data.facets);
          setLoading(false);

          if (data.expansion?.wasExpanded && data.expansion.original.toLowerCase() !== data.expansion.corrected.toLowerCase()) {
            setCorrection({ original: data.expansion.original, corrected: data.expansion.corrected });
          } else {
            setCorrection(null);
          }

          const urlParams = filtersToParams(q, EMPTY_FILTERS, newSort, 1);
          const urlStr = urlParams.toString();
          router.replace(`/explore${urlStr ? `?${urlStr}` : ""}`, { scroll: false });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.message === "quota") {
          setError("Limite de 100 recherches par 24h atteinte. Réessayez demain.");
        } else {
          setError("Erreur lors de la recherche. Reessayez.");
        }
        setLoading(false);
        console.error("[explore] Search error:", err);
      }
    },
    [query, doSearch, router]
  );

  // Initial load
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      // If URL has filters already (e.g. shared link), do direct search
      if (hasAnyFilter(initialFilters) || !initialQuery) {
        doSearch(submittedQuery, filters, sort, page);
      } else {
        // Fresh query from URL: run through handleSubmit flow
        handleSubmit(undefined, initialQuery);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ─────────────────────────────────────────────────

  const handleFiltersChange = (newFilters: FacetFilters) => {
    setFilters(newFilters);
    setPage(1);
    doSearch(submittedQuery, newFilters, sort, 1);
  };

  const handleRemoveFilter = (key: string, group: string) => {
    if (group === "dateAfter") {
      handleFiltersChange({ ...filters, dateAfter: undefined });
    } else if (group === "qualityMin") {
      handleFiltersChange({ ...filters, qualityMin: undefined });
    } else if (group === "geoScopes") {
      const newScopes = filters.geoScopes.filter((v) => v !== key);
      handleFiltersChange({
        ...filters,
        geoScopes: newScopes,
        geoAreas: newScopes.length > 0 ? filters.geoAreas : [],
      });
    } else {
      const newFilters = {
        ...filters,
        [group]: (filters[group as keyof FacetFilters] as string[]).filter((v) => v !== key),
      };
      handleFiltersChange(newFilters);
    }
  };

  const handleReset = () => {
    setQuery("");
    setSubmittedQuery("");
    setFilters(EMPTY_FILTERS);
    setSort("downloads");
    setPage(1);
    setCorrection(null);
    doSearch("", EMPTY_FILTERS, "downloads", 1);
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setPage(1);
    doSearch(submittedQuery, filters, newSort, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    doSearch(submittedQuery, filters, sort, newPage);
    document.getElementById("results-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const totalPages = Math.ceil(total / 20);
  const activeFilterCount =
    filters.categories.length + filters.subcategories.length +
    filters.geoScopes.length + filters.geoAreas.length +
    filters.types.length + filters.licenses.length +
    (filters.dateAfter ? 1 : 0) + (filters.qualityMin ? 1 : 0);

  return (
    <main className="flex-1 flex flex-col">
      {/* Search bar */}
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <form onSubmit={handleSubmit}>
            <div className="flex gap-2 max-w-3xl mx-auto">
              <div className="relative flex-1">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un dataset par mot-cle, theme ou territoire..."
                  className="pl-14 h-14 text-lg rounded-xl shadow-sm"
                  autoFocus
                />
                {loading && (
                  <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
                )}
              </div>
              <Button type="submit" size="lg" className="h-14 px-6 rounded-xl gap-2">
                <Search className="h-5 w-5" />
                <span className="hidden sm:inline">Rechercher</span>
              </Button>
            </div>
          </form>

          {/* Active filters pills */}
          {hasAnyFilter(filters) && (
            <div className="max-w-3xl mx-auto mt-3">
              <ActiveFilters
                filters={activeFiltersList(filters)}
                onRemove={handleRemoveFilter}
                onReset={handleReset}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main: facets + results */}
      <div className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="flex gap-8" id="results-top">
            {/* Facet sidebar — desktop */}
            <aside className="hidden lg:block w-64 shrink-0">
              <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 scrollbar-thin">
                <FacetPanel facets={facets} filters={filters} onChange={handleFiltersChange} />
              </div>
            </aside>

            {/* Results */}
            <div className="flex-1 min-w-0 space-y-4">
              {/* Mobile filter + toolbar */}
              <div className="flex items-center gap-3">
                <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="lg:hidden gap-2 h-9">
                      <SlidersHorizontal className="h-4 w-4" />
                      Filtres
                      {activeFilterCount > 0 && (
                        <span className="bg-primary text-primary-foreground rounded-full h-5 w-5 text-xs flex items-center justify-center">
                          {activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-80 overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Filtres</SheetTitle>
                    </SheetHeader>
                    <div className="mt-6">
                      <FacetPanel
                        facets={facets}
                        filters={filters}
                        onChange={handleFiltersChange}
                      />
                    </div>
                    <div className="mt-6 flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => { handleFiltersChange(EMPTY_FILTERS); setMobileFiltersOpen(false); }}>
                        Reinitialiser
                      </Button>
                      <Button className="flex-1" onClick={() => setMobileFiltersOpen(false)}>
                        Appliquer
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
                <div className="flex-1">
                  <ResultsToolbar total={total} sort={sort} onSortChange={handleSortChange} hasQuery={!!submittedQuery} />
                </div>
              </div>

              {/* Correction banner */}
              {correction && (
                <CorrectionBanner
                  original={correction.original}
                  corrected={correction.corrected}
                  onSearchOriginal={() => {
                    setQuery(correction.original);
                    setCorrection(null);
                    setFilters(EMPTY_FILTERS);
                    doSearch(correction.original, EMPTY_FILTERS, sort, 1);
                  }}
                />
              )}

              {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

              {loading && results.length === 0 && (
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
                </div>
              )}

              {!loading && results.length === 0 && !error && (
                <div className="text-center py-16 space-y-3">
                  <p className="text-lg font-medium">Aucun resultat</p>
                  <p className="text-sm text-muted-foreground">Essayez de modifier votre recherche ou de retirer certains filtres.</p>
                  {hasAnyFilter(filters) && (
                    <Button variant="outline" size="sm" onClick={handleReset}>Reinitialiser les filtres</Button>
                  )}
                </div>
              )}

              {results.length > 0 && (
                <div className="space-y-3">
                  {results.map((item) => <ResultCard key={item.id} {...item} />)}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <span className="text-sm text-muted-foreground">Page {page} sur {totalPages.toLocaleString("fr-FR")}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-9 w-9" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {generatePageNumbers(page, totalPages).map((p, i) =>
                      p === "..." ? (
                        <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">...</span>
                      ) : (
                        <Button key={p} variant={p === page ? "default" : "ghost"} size="icon" className="h-9 w-9 text-sm" onClick={() => handlePageChange(p as number)}>
                          {p}
                        </Button>
                      )
                    )}
                    <Button variant="ghost" size="icon" className="h-9 w-9" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function generatePageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

export default function ExplorePage() {
  return <Suspense><ExploreContent /></Suspense>;
}
