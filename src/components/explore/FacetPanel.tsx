"use client";

import { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, MapPin, Calendar, Star } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface FacetFilters {
  categories: string[];
  subcategories: string[];
  geoScopes: string[];
  geoAreas: string[];
  types: string[];
  licenses: string[];
  /** ISO date string — only items modified on or after */
  dateAfter?: string;
  /** Minimum quality score (1-5) */
  qualityMin?: number;
}

export interface FacetCounts {
  categories: FacetValue[];
  subcategories: FacetValue[];
  geoScopes: FacetValue[];
  geoAreas: FacetValue[];
  types: FacetValue[];
  licenses: FacetValue[];
}

interface FacetPanelProps {
  facets: FacetCounts;
  filters: FacetFilters;
  onChange: (filters: FacetFilters) => void;
  total?: number;
}

// ── Date presets ─────────────────────────────────────────────────

interface DatePreset {
  key: string;
  label: string;
  days: number;
}

const DATE_PRESETS: DatePreset[] = [
  { key: "7d", label: "7 derniers jours", days: 7 },
  { key: "30d", label: "30 derniers jours", days: 30 },
  { key: "90d", label: "3 derniers mois", days: 90 },
  { key: "365d", label: "Derniere annee", days: 365 },
];

function datePresetToISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function getActiveDatePreset(dateAfter?: string): string | null {
  if (!dateAfter) return null;
  const afterMs = new Date(dateAfter).getTime();
  const nowMs = Date.now();
  const diffDays = Math.round((nowMs - afterMs) / (24 * 60 * 60 * 1000));
  // Find closest preset (±1 day tolerance)
  for (const p of DATE_PRESETS) {
    if (Math.abs(diffDays - p.days) <= 1) return p.key;
  }
  return null;
}

function DateFilter({
  dateAfter,
  onChange,
}: {
  dateAfter?: string;
  onChange: (dateAfter?: string) => void;
}) {
  const active = getActiveDatePreset(dateAfter);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">Mise à jour</h4>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onChange(active === p.key ? undefined : datePresetToISO(p.days))}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              active === p.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted/50 border-border text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Quality filter ───────────────────────────────────────────────

const QUALITY_LEVELS = [
  { min: 4, label: "Excellente", stars: 4 },
  { min: 3, label: "Bonne", stars: 3 },
  { min: 2, label: "Moyenne", stars: 2 },
];

function QualityFilter({
  qualityMin,
  onChange,
}: {
  qualityMin?: number;
  onChange: (qualityMin?: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">Qualité</h4>
      </div>
      <div className="space-y-0.5">
        {QUALITY_LEVELS.map((level) => (
          <button
            key={level.min}
            onClick={() => onChange(qualityMin === level.min ? undefined : level.min)}
            className={`flex items-center gap-2 w-full px-1 py-1 rounded text-left transition-colors ${
              qualityMin === level.min
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted/50 text-foreground"
            }`}
          >
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3 w-3 ${
                    i < level.stars
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs">{level.label} et +</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function toggleValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

// ── FacetGroup (generic checkbox list with optional search) ──────

interface FacetGroupProps {
  title: string;
  values: FacetValue[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxVisible?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

function FacetGroup({
  title,
  values,
  selected,
  onChange,
  maxVisible = 8,
  searchable = false,
  searchPlaceholder = "Rechercher...",
  collapsible = false,
  defaultOpen = true,
}: FacetGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(defaultOpen);

  const filtered = useMemo(() => {
    if (!search.trim()) return values;
    const q = search.toLowerCase().trim();
    return values.filter((fv) => fv.label.toLowerCase().includes(q));
  }, [values, search]);

  const displayed = expanded ? filtered : filtered.slice(0, maxVisible);
  const hasMore = filtered.length > maxVisible;

  if (values.length === 0) return null;

  return (
    <div className="space-y-2">
      {collapsible ? (
        <button
          className="flex items-center gap-1.5 w-full text-left"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        </button>
      ) : (
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      )}

      {(!collapsible || open) && (
        <>
          {searchable && values.length > maxVisible && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setExpanded(true); }}
                placeholder={searchPlaceholder}
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}
          <div className="space-y-0.5">
            {displayed.map((fv) => (
              <label
                key={fv.value}
                className="flex items-center gap-2.5 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={selected.includes(fv.value)}
                  onCheckedChange={() => onChange(toggleValue(selected, fv.value))}
                  className="h-4 w-4"
                />
                <span className="text-sm flex-1 min-w-0 truncate">{fv.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {fv.count.toLocaleString("fr-FR")}
                </span>
              </label>
            ))}
          </div>
          {hasMore && !search && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 w-full justify-start gap-1 text-muted-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-3 w-3" /> Moins
                </>
              ) : (
                <>
                  <ChevronRight className="h-3 w-3" /> {filtered.length - maxVisible} de plus
                </>
              )}
            </Button>
          )}
          {search && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-1">Aucun resultat</p>
          )}
        </>
      )}
    </div>
  );
}

// ── GeoFacetGroup (hierarchical: scope → areas) ─────────────────

const GEO_SCOPE_ORDER = ["national", "regional", "departemental", "communal"];
const GEO_SCOPE_LABELS: Record<string, string> = {
  national: "National",
  regional: "Regional",
  departemental: "Departemental",
  communal: "Communal",
};
const GEO_AREA_PLACEHOLDERS: Record<string, string> = {
  regional: "Rechercher une region...",
  departemental: "Rechercher un departement...",
  communal: "Rechercher une commune...",
};

interface GeoFacetGroupProps {
  geoScopes: FacetValue[];
  geoAreas: FacetValue[];
  selectedScopes: string[];
  selectedAreas: string[];
  onChangeScopes: (scopes: string[]) => void;
  onChangeAreas: (areas: string[]) => void;
}

function GeoFacetGroup({
  geoScopes,
  geoAreas,
  selectedScopes,
  selectedAreas,
  onChangeScopes,
  onChangeAreas,
}: GeoFacetGroupProps) {
  const [areaSearch, setAreaSearch] = useState<Record<string, string>>({});
  const [areaExpanded, setAreaExpanded] = useState<Record<string, boolean>>({});

  // Group areas by their parent scope
  // We need to figure out which areas belong to which scope.
  // The backend returns all areas matching the current geoScope filter.
  // When multiple scopes are selected, areas are mixed. We group by checking
  // which scope is active — if only one scope is selected, all areas belong to it.
  // If multiple, we show areas as a flat list under each scope.

  // Sort scopes in order
  const sortedScopes = useMemo(() => {
    const scopeMap = new Map(geoScopes.map((s) => [s.value, s]));
    return GEO_SCOPE_ORDER
      .filter((s) => scopeMap.has(s))
      .map((s) => scopeMap.get(s)!);
  }, [geoScopes]);

  // Determine which scopes should show area sub-list
  const scopesWithAreas = useMemo(() => {
    return new Set(selectedScopes);
  }, [selectedScopes]);

  // Filter areas based on search per scope
  const getFilteredAreas = (scope: string) => {
    const q = (areaSearch[scope] || "").toLowerCase().trim();
    const areas = geoAreas; // all available areas (backend already filters by active geoScope)
    if (!q) return areas;
    return areas.filter((a) => a.label.toLowerCase().includes(q));
  };

  const toggleScope = (scope: string) => {
    const newScopes = toggleValue(selectedScopes, scope);
    onChangeScopes(newScopes);
    // onChangeScopes already clears geoAreas (see FacetPanel below)
  };

  if (sortedScopes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">Territoire</h4>
      </div>
      <div className="space-y-1">
        {sortedScopes.map((scope) => {
          const isSelected = selectedScopes.includes(scope.value);
          const showAreas = isSelected && geoAreas.length > 0;
          const maxVisible = 8;
          const filteredAreas = showAreas ? getFilteredAreas(scope.value) : [];
          const isExpanded = areaExpanded[scope.value] || false;
          const displayedAreas = isExpanded ? filteredAreas : filteredAreas.slice(0, maxVisible);
          const hasMoreAreas = filteredAreas.length > maxVisible;
          const searchVal = areaSearch[scope.value] || "";

          return (
            <div key={scope.value}>
              {/* Scope checkbox */}
              <label className="flex items-center gap-2.5 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer transition-colors">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleScope(scope.value)}
                  className="h-4 w-4"
                />
                <span className="text-sm flex-1 min-w-0 font-medium">
                  {GEO_SCOPE_LABELS[scope.value] || scope.label}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {scope.count.toLocaleString("fr-FR")}
                </span>
              </label>

              {/* Area sub-list (shown when scope is checked, except national) */}
              {showAreas && selectedScopes.length === 1 && (
                <div className="ml-6 mt-1 mb-2 space-y-1 border-l-2 border-muted pl-3 max-h-64 overflow-y-auto">
                  {/* Area search */}
                  {geoAreas.length > maxVisible && (
                    <div className="relative mb-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <Input
                        value={searchVal}
                        onChange={(e) => {
                          setAreaSearch({ ...areaSearch, [scope.value]: e.target.value });
                          setAreaExpanded({ ...areaExpanded, [scope.value]: true });
                        }}
                        placeholder={GEO_AREA_PLACEHOLDERS[scope.value] || "Rechercher..."}
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                  )}
                  {displayedAreas.map((area) => (
                    <label
                      key={area.value}
                      className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedAreas.includes(area.value)}
                        onCheckedChange={() => onChangeAreas(toggleValue(selectedAreas, area.value))}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs flex-1 min-w-0 truncate">{area.label}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {area.count.toLocaleString("fr-FR")}
                      </span>
                    </label>
                  ))}
                  {hasMoreAreas && !searchVal && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6 w-full justify-start gap-1 text-muted-foreground"
                      onClick={() => setAreaExpanded({ ...areaExpanded, [scope.value]: !isExpanded })}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronDown className="h-3 w-3" /> Moins
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3 w-3" /> {filteredAreas.length - maxVisible} de plus
                        </>
                      )}
                    </Button>
                  )}
                  {searchVal && filteredAreas.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1">Aucun resultat</p>
                  )}
                </div>
              )}

              {/* When multiple scopes selected, show areas as flat list after all scopes */}
            </div>
          );
        })}

        {/* Multi-scope area list: show flat when >1 scope selected with areas */}
        {scopesWithAreas.size > 1 && geoAreas.length > 0 && (
          <MultiScopeAreas
            geoAreas={geoAreas}
            selectedAreas={selectedAreas}
            onChangeAreas={onChangeAreas}
          />
        )}
      </div>
    </div>
  );
}

function MultiScopeAreas({
  geoAreas,
  selectedAreas,
  onChangeAreas,
}: {
  geoAreas: FacetValue[];
  selectedAreas: string[];
  onChangeAreas: (areas: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const maxVisible = 8;

  const filtered = useMemo(() => {
    if (!search.trim()) return geoAreas;
    const q = search.toLowerCase().trim();
    return geoAreas.filter((a) => a.label.toLowerCase().includes(q));
  }, [geoAreas, search]);

  const displayed = expanded ? filtered : filtered.slice(0, maxVisible);
  const hasMore = filtered.length > maxVisible;

  return (
    <div className="ml-6 mt-1 mb-2 space-y-1 border-l-2 border-muted pl-3 max-h-64 overflow-y-auto">
      <p className="text-xs font-medium text-muted-foreground mb-1">Zones</p>
      {geoAreas.length > maxVisible && (
        <div className="relative mb-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpanded(true); }}
            placeholder="Rechercher une zone..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}
      {displayed.map((area) => (
        <label
          key={area.value}
          className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer transition-colors"
        >
          <Checkbox
            checked={selectedAreas.includes(area.value)}
            onCheckedChange={() => onChangeAreas(toggleValue(selectedAreas, area.value))}
            className="h-3.5 w-3.5"
          />
          <span className="text-xs flex-1 min-w-0 truncate">{area.label}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {area.count.toLocaleString("fr-FR")}
          </span>
        </label>
      ))}
      {hasMore && !search && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-6 w-full justify-start gap-1 text-muted-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" /> Moins
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" /> {filtered.length - maxVisible} de plus
            </>
          )}
        </Button>
      )}
      {search && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">Aucun resultat</p>
      )}
    </div>
  );
}

// ── Main FacetPanel ──────────────────────────────────────────────

export function FacetPanel({ facets, filters, onChange }: FacetPanelProps) {
  return (
    <div className="space-y-6">
      {/* Categories (Theme) */}
      <FacetGroup
        title="Thème"
        values={facets.categories}
        selected={filters.categories}
        onChange={(v) => onChange({ ...filters, categories: v, subcategories: [] })}
      />

      {/* Subcategories (dynamic, shown when category selected) */}
      {facets.subcategories.length > 0 && (
        <FacetGroup
          title="Sous-thème"
          values={facets.subcategories}
          selected={filters.subcategories}
          onChange={(v) => onChange({ ...filters, subcategories: v })}
          maxVisible={10}
          searchable
          searchPlaceholder="Rechercher un sous-thème..."
        />
      )}

      {/* Territory (hierarchical geo) */}
      <GeoFacetGroup
        geoScopes={facets.geoScopes}
        geoAreas={facets.geoAreas}
        selectedScopes={filters.geoScopes}
        selectedAreas={filters.geoAreas}
        onChangeScopes={(v) => onChange({ ...filters, geoScopes: v, geoAreas: [] })}
        onChangeAreas={(v) => onChange({ ...filters, geoAreas: v })}
      />

      {/* Date preset filter */}
      <DateFilter
        dateAfter={filters.dateAfter}
        onChange={(v) => onChange({ ...filters, dateAfter: v })}
      />

      {/* Quality filter */}
      <QualityFilter
        qualityMin={filters.qualityMin}
        onChange={(v) => onChange({ ...filters, qualityMin: v })}
      />

      {/* Type */}
      <FacetGroup
        title="Type"
        values={facets.types}
        selected={filters.types}
        onChange={(v) => onChange({ ...filters, types: v })}
        maxVisible={4}
      />

      {/* License */}
      <FacetGroup
        title="Licence"
        values={facets.licenses}
        selected={filters.licenses}
        onChange={(v) => onChange({ ...filters, licenses: v })}
        searchable
        searchPlaceholder="Rechercher une licence..."
      />
    </div>
  );
}
