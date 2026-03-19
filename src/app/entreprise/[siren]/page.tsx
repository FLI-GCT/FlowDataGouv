import { notFound } from "next/navigation";
import { getEntreprise, getEtablissements, isAvailable } from "@/lib/sirene/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MapPin, Calendar, Activity, Users, ArrowLeft } from "lucide-react";

interface Props {
  params: Promise<{ siren: string }>;
}

const EFFECTIFS: Record<string, string> = {
  "NN": "Non employeuse", "00": "0 salarié", "01": "1-2 salariés", "02": "3-5 salariés",
  "03": "6-9 salariés", "11": "10-19 salariés", "12": "20-49 salariés", "21": "50-99 salariés",
  "22": "100-199 salariés", "31": "200-249 salariés", "32": "250-499 salariés",
  "41": "500-999 salariés", "42": "1 000-1 999 salariés", "51": "2 000-4 999 salariés",
  "52": "5 000-9 999 salariés", "53": "10 000+ salariés",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siren } = await params;
  if (!isAvailable() || !/^\d{9}$/.test(siren)) return { title: "Entreprise introuvable" };
  const e = getEntreprise(siren);
  if (!e) return { title: "Entreprise introuvable" };

  const title = `${e.denomination || "Entreprise"} — SIREN ${siren}`;
  const description = `Informations légales sur ${e.denomination} (SIREN ${siren}). Activité : ${e.activite_principale || "non renseignée"}. Statut : ${e.etat_administratif === "A" ? "Active" : "Cessée"}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    other: {
      "application/ld+json": JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: e.denomination,
        identifier: siren,
        foundingDate: e.date_creation,
      }),
    },
  };
}

export default async function EntreprisePage({ params }: Props) {
  const { siren } = await params;

  if (!isAvailable()) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold mb-4">Base SIRENE non disponible</h1>
        <p className="text-muted-foreground">La base de données des entreprises n&apos;a pas encore été importée.</p>
      </div>
    );
  }

  if (!/^\d{9}$/.test(siren)) notFound();

  const entreprise = getEntreprise(siren);
  if (!entreprise) notFound();

  const etablissements = getEtablissements(siren);
  const siege = etablissements.find((e) => e.est_siege === 1);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link href="/entreprise" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6">
        <ArrowLeft className="h-4 w-4" /> Recherche entreprises
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">{entreprise.denomination || "Sans dénomination"}</h1>
          {entreprise.sigle && <p className="text-lg text-muted-foreground">{entreprise.sigle}</p>}
          <p className="font-mono text-sm text-muted-foreground mt-1">SIREN {siren}</p>
        </div>
        <span className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold ${entreprise.etat_administratif === "A" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
          {entreprise.etat_administratif === "A" ? "Active" : "Cessée"}
        </span>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {entreprise.activite_principale && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Activity className="h-4 w-4" /> Activité principale
            </div>
            <p className="text-lg font-semibold">{entreprise.activite_principale}</p>
          </div>
        )}
        {entreprise.categorie_juridique && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Building2 className="h-4 w-4" /> Catégorie juridique
            </div>
            <p className="text-lg font-semibold">{entreprise.categorie_juridique}</p>
          </div>
        )}
        {entreprise.tranche_effectifs && EFFECTIFS[entreprise.tranche_effectifs] && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Users className="h-4 w-4" /> Effectifs
            </div>
            <p className="text-lg font-semibold">{EFFECTIFS[entreprise.tranche_effectifs]}</p>
          </div>
        )}
        {entreprise.date_creation && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
              <Calendar className="h-4 w-4" /> Date de création
            </div>
            <p className="text-lg font-semibold">{entreprise.date_creation}</p>
          </div>
        )}
      </div>

      {/* Siège social */}
      {siege && (
        <div className="rounded-lg border bg-card p-4 mb-8">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
            <MapPin className="h-4 w-4" /> Siège social
          </div>
          <p className="text-sm">
            {[siege.adresse_numero, siege.adresse_voie].filter(Boolean).join(" ")}
            {siege.adresse_code_postal && ` — ${siege.adresse_code_postal}`}
            {siege.adresse_commune && ` ${siege.adresse_commune}`}
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-1">SIRET {siege.siret}</p>
        </div>
      )}

      {/* Établissements */}
      {etablissements.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">
            {etablissements.length} établissement{etablissements.length > 1 ? "s" : ""}
          </h2>
          <div className="space-y-2">
            {etablissements.map((etab) => (
              <div key={etab.siret} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">{etab.siret}</span>
                    {etab.enseigne && <span className="ml-2 font-medium">{etab.enseigne}</span>}
                    {etab.est_siege === 1 && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">Siège</span>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold ${etab.etat_administratif === "A" ? "text-green-600" : "text-red-500"}`}>
                    {etab.etat_administratif === "A" ? "Actif" : "Fermé"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {[etab.adresse_numero, etab.adresse_voie, etab.adresse_code_postal, etab.adresse_commune].filter(Boolean).join(" ")}
                  {etab.activite_principale && ` — APE ${etab.activite_principale}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source */}
      <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
        Source : <a href="https://www.data.gouv.fr/fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/" className="text-primary hover:underline" target="_blank" rel="noopener">Base Sirene des entreprises (INSEE)</a> — Licence Ouverte
      </div>
    </div>
  );
}
