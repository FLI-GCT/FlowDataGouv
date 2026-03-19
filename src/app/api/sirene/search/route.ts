import { NextResponse } from "next/server";
import { searchEntreprises, isAvailable } from "@/lib/sirene/db";

export async function GET(request: Request) {
  if (!isAvailable()) {
    return NextResponse.json(
      { error: "Base SIRENE non disponible", hint: "Exécutez scripts/import-sirene.ts pour importer les données" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  if (!q.trim()) {
    return NextResponse.json({ error: "Paramètre 'q' requis" }, { status: 400 });
  }

  const filters: { etat_administratif?: string; activite_principale?: string; commune?: string } = {};
  const statut = url.searchParams.get("statut");
  if (statut) filters.etat_administratif = statut.toUpperCase();
  const activite = url.searchParams.get("activite");
  if (activite) filters.activite_principale = activite;

  const t0 = Date.now();
  const { total, results } = searchEntreprises(q, filters, limit, offset);
  const durationMs = Date.now() - t0;

  return NextResponse.json({
    query: q,
    total,
    results,
    limit,
    offset,
    durationMs,
  });
}
