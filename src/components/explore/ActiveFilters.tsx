"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export interface ActiveFilter {
  key: string;
  group: string;
  label: string;
}

interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (key: string, group: string) => void;
  onReset: () => void;
}

export function ActiveFilters({ filters, onRemove, onReset }: ActiveFiltersProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <Badge
          key={`${f.group}-${f.key}`}
          variant="secondary"
          className="text-sm gap-1.5 pl-3 pr-1.5 py-1 hover:bg-destructive/10 transition-colors"
        >
          {f.label}
          <button
            className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
            onClick={(e) => { e.stopPropagation(); onRemove(f.key, f.group); }}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground h-7"
        onClick={onReset}
      >
        Reinitialiser
      </Button>
    </div>
  );
}
