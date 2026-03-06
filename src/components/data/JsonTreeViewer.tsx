"use client";

import { useState, useCallback } from "react";
import { JsonView, allExpanded } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";

interface JsonTreeViewerProps {
  data: unknown;
  totalItems?: number | null;
  displayedItems?: number | null;
  truncated?: boolean;
}

export function JsonTreeViewer({
  data,
  totalItems,
  displayedItems,
  truncated = false,
}: JsonTreeViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {totalItems != null && (
            <Badge variant="outline">
              {displayedItems != null && truncated
                ? `${displayedItems.toLocaleString("fr-FR")} / ${totalItems.toLocaleString("fr-FR")} elements`
                : `${totalItems.toLocaleString("fr-FR")} element${totalItems > 1 ? "s" : ""}`}
            </Badge>
          )}
          {truncated && (
            <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">
              Extrait partiel
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copie !" : "Copier JSON"}
        </Button>
      </div>
      <div className="rounded-md border bg-muted/30 p-3 max-h-[500px] overflow-auto text-xs">
        <JsonView
          data={data as object}
          shouldExpandNode={allExpanded}
        />
      </div>
    </div>
  );
}
