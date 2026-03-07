"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ResultsToolbarProps {
  total: number;
  sort: string;
  onSortChange: (sort: string) => void;
  hasQuery: boolean;
}

export function ResultsToolbar({ total, sort, onSortChange, hasQuery }: ResultsToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">
          {total.toLocaleString("fr-FR")}
        </span>
        {" "}resultat{total !== 1 ? "s" : ""}
      </p>
      <Select value={sort} onValueChange={onSortChange}>
        <SelectTrigger className="w-[180px] h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hasQuery && <SelectItem value="relevance">Pertinence</SelectItem>}
          <SelectItem value="downloads">Téléchargements</SelectItem>
          <SelectItem value="views">Visites</SelectItem>
          <SelectItem value="lastModified">Date de mise à jour</SelectItem>
          <SelectItem value="quality">Qualité</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
