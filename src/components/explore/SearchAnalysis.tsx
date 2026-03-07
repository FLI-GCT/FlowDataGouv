"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronRight,
  Brain,
  Lightbulb,
  FolderOpen,
  FileText,
} from "lucide-react";
import type { ParsedDataset } from "@/lib/parsers";
import type {
  SearchAnalysis as SearchAnalysisType,
  AnalysisGroup,
} from "@/lib/search/analyze";

interface SearchAnalysisProps {
  analysis: SearchAnalysisType | null;
  loading: boolean;
  datasets: Map<string, ParsedDataset>;
  onDatasetClick?: (datasetId: string) => void;
}

const GROUP_COLORS = [
  "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20",
  "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
  "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20",
  "border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/20",
  "border-rose-200 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/20",
  "border-cyan-200 bg-cyan-50/50 dark:border-cyan-800 dark:bg-cyan-950/20",
];

export function SearchAnalysis({
  analysis,
  loading,
  datasets,
  onDatasetClick,
}: SearchAnalysisProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
    new Set([0])
  );

  if (loading) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">
            Analyse en cours...
          </span>
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  if (!analysis || (!analysis.summary && analysis.groups.length === 0))
    return null;

  function toggleGroup(idx: number) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <Card className="p-5 space-y-4 border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50/50 to-transparent dark:from-violet-950/20">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Brain className="h-5 w-5 text-violet-600" />
        <h3 className="text-base font-bold">Analyse des résultats</h3>
      </div>

      {/* Summary */}
      {analysis.summary && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {analysis.summary}
        </p>
      )}

      {/* Groups */}
      {analysis.groups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {analysis.groups.map((group, idx) => (
            <GroupBlock
              key={idx}
              group={group}
              index={idx}
              expanded={expandedGroups.has(idx)}
              onToggle={() => toggleGroup(idx)}
              datasets={datasets}
              onDatasetClick={onDatasetClick}
            />
          ))}
        </div>
      )}

      {/* Insights */}
      {analysis.insights.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
            <Lightbulb className="h-4 w-4" />
            Observations
          </div>
          {analysis.insights.map((insight, i) => (
            <p
              key={i}
              className="text-sm text-muted-foreground pl-6 leading-relaxed"
            >
              {insight}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function GroupBlock({
  group,
  index,
  expanded,
  onToggle,
  datasets,
  onDatasetClick,
}: {
  group: AnalysisGroup;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  datasets: Map<string, ParsedDataset>;
  onDatasetClick?: (id: string) => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${GROUP_COLORS[index % GROUP_COLORS.length]}`}
    >
      <button
        className="flex w-full items-center gap-2.5 text-left"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <FolderOpen className="h-4 w-4 shrink-0 opacity-60" />
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">
          {group.label}
        </span>
        <Badge variant="secondary" className="text-xs shrink-0">
          {group.datasetIds.length}
        </Badge>
      </button>

      {!expanded && (
        <p className="text-sm text-muted-foreground mt-1 pl-10 line-clamp-1">
          {group.description}
        </p>
      )}

      {expanded && (
        <div className="mt-2 pl-10 space-y-1">
          <p className="text-sm text-muted-foreground mb-2">
            {group.description}
          </p>
          {group.datasetIds.map((id) => {
            const ds = datasets.get(id);
            if (!ds) return null;
            return (
              <button
                key={id}
                className="flex items-start gap-2 w-full text-left p-2 rounded hover:bg-white/60 dark:hover:bg-white/5 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onDatasetClick?.(id);
                }}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
                <span className="text-sm text-blue-700 dark:text-blue-400 line-clamp-2 leading-snug">
                  {ds.title}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
