"use client";

import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, Loader2 } from "lucide-react";

export interface KeywordStatus {
  keyword: string;
  status: "pending" | "loading" | "done";
  resultCount?: number;
}

interface SearchKeywordsProps {
  original: string;
  corrected: string;
  keywords: KeywordStatus[];
  wasExpanded: boolean;
}

export function SearchKeywords({
  original,
  corrected,
  keywords,
  wasExpanded,
}: SearchKeywordsProps) {
  if (!wasExpanded || keywords.length === 0) return null;

  const hasCorrected = original.toLowerCase() !== corrected.toLowerCase();

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium text-muted-foreground">
          Recherche intelligente
        </span>
      </div>

      {hasCorrected && (
        <p className="text-base mb-2.5">
          <span className="line-through text-muted-foreground/60">{original}</span>
          {" "}
          <span className="font-medium">{corrected}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {keywords.map((kw) => (
          <Badge
            key={kw.keyword}
            variant={kw.status === "done" ? "default" : "outline"}
            className={`text-sm gap-1.5 px-3 py-1 transition-all ${
              kw.status === "loading"
                ? "animate-pulse border-primary/50"
                : kw.status === "done"
                ? "bg-primary/10 text-primary border-primary/30"
                : ""
            }`}
          >
            {kw.status === "loading" && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {kw.status === "done" && (
              <Check className="h-3 w-3" />
            )}
            {kw.keyword}
            {kw.status === "done" && kw.resultCount != null && (
              <span className="opacity-60 ml-0.5">({kw.resultCount})</span>
            )}
          </Badge>
        ))}
      </div>
    </div>
  );
}
