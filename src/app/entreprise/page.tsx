"use client";

import { useState, useCallback } from "react";
import { Search, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface Entreprise {
  siren: string;
  denomination: string;
  sigle: string | null;
  activite_principale: string | null;
  categorie_juridique: string | null;
  tranche_effectifs: string | null;
  date_creation: string | null;
  etat_administratif: string;
}

const EFFECTIFS: Record<string, string> = {
  "NN": "Non employeuse", "00": "0", "01": "1-2", "02": "3-5", "03": "6-9",
  "11": "10-19", "12": "20-49", "21": "50-99", "22": "100-199", "31": "200-249",
  "32": "250-499", "41": "500-999", "42": "1000-1999", "51": "2000-4999",
  "52": "5000-9999", "53": "10000+",
};

export default function EntreprisesPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entreprise[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q: query, limit: "30" });
      const res = await fetch(`/api/sirene/search?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      if (data.error) {
        setResults([]);
        setTotal(0);
      } else {
        setResults(data.results || []);
        setTotal(data.total || 0);
        setDurationMs(data.durationMs || 0);
      }
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Recherche d&apos;entreprises</h1>
          <p className="mt-2 text-muted-foreground">
            Recherchez parmi 29 millions d&apos;entreprises de la base SIRENE (INSEE)
          </p>
        </div>

        {/* Search form */}
        <div className="flex gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Nom d'entreprise ou numero SIREN..."
              className="w-full rounded-lg border bg-background px-4 py-2.5 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button onClick={search} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rechercher"}
          </Button>
        </div>

        {/* Results */}
        {searched && (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground mb-4">
              {total > 0
                ? `${total.toLocaleString("fr-FR")} resultat${total > 1 ? "s" : ""} en ${durationMs} ms`
                : "Aucun resultat"}
            </p>
            <div className="space-y-2">
              {results.map((e) => (
                <Link
                  key={e.siren}
                  href={`/entreprise/${e.siren}`}
                  className="block rounded-lg border bg-card p-4 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{e.denomination || "Sans denomination"}</span>
                        {e.sigle && <span className="text-xs text-muted-foreground">({e.sigle})</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{e.siren}</span>
                        {e.activite_principale && <span>APE {e.activite_principale}</span>}
                        {e.tranche_effectifs && EFFECTIFS[e.tranche_effectifs] && (
                          <span>{EFFECTIFS[e.tranche_effectifs]} salaries</span>
                        )}
                        {e.date_creation && <span>Creee le {e.date_creation}</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${e.etat_administratif === "A" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                      {e.etat_administratif === "A" ? "Active" : "Cessée"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Help */}
        {!searched && (
          <div className="mt-8 text-center text-sm text-muted-foreground space-y-2">
            <p>Exemples de recherche :</p>
            <div className="flex flex-wrap justify-center gap-2">
              {["FLOW LINE INTEGRATION", "SANTIANE", "489649897", "CARREFOUR"].map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setQuery(ex); }}
                  className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
            <p className="text-xs mt-4">
              Donnees issues de la <a href="https://www.data.gouv.fr/fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/" className="text-primary hover:underline" target="_blank" rel="noopener">Base Sirene (INSEE)</a> — Licence Ouverte
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
