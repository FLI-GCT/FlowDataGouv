import { NextResponse } from "next/server";
import { getEntreprise, getEtablissements, isAvailable } from "@/lib/sirene/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siren: string }> },
) {
  if (!isAvailable()) {
    return NextResponse.json(
      { error: "Base SIRENE non disponible" },
      { status: 503 },
    );
  }

  const { siren } = await params;

  if (!/^\d{9}$/.test(siren)) {
    return NextResponse.json(
      { error: "SIREN invalide (9 chiffres attendus)" },
      { status: 400 },
    );
  }

  const entreprise = getEntreprise(siren);
  if (!entreprise) {
    return NextResponse.json(
      { error: `Entreprise non trouvée : ${siren}` },
      { status: 404 },
    );
  }

  const etablissements = getEtablissements(siren);

  return NextResponse.json({
    entreprise,
    etablissements,
    etablissementsCount: etablissements.length,
  });
}
