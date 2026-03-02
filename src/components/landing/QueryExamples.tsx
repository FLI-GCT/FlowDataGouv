"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const EXAMPLES = [
  "Qualite de l'air",
  "Transport en commun",
  "Budget des collectivites",
  "Logement social",
  "Elections municipales",
  "Cadastre parcellaire",
];

export function QueryExamples() {
  const router = useRouter();

  return (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      {EXAMPLES.map((ex) => (
        <button
          key={ex}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
          onClick={() => router.push(`/explore?q=${encodeURIComponent(ex)}`)}
        >
          <Search className="h-3 w-3" />
          {ex}
        </button>
      ))}
    </div>
  );
}
