/**
 * Backend catalog sync: incrementally fetches + enriches datasets from data.gouv.fr.
 *
 * Architecture:
 *   data/store.json   — persistent enriched dataset store (all metadata, descriptions)
 *   data/catalog.json  — pre-built frontend catalog (categories, geo, stats, search data)
 *
 * Sync flow:
 *   1. Fetch ALL datasets + APIs from data.gouv.fr (incremental: only adds new ones)
 *   2. Batch-enrich unprocessed items with Mistral (10 per call, concurrent)
 *   3. Rebuild catalog.json from enriched store
 *
 * Mistral optimization: 10 datasets per call → 7.3k calls instead of 73k.
 * Each batch call returns: category, subcategory, geographic scope/area, summary, themes, quality.
 *
 * Geographic categorization: national / regional / departemental / communal
 * Knowledge graph: implicit through shared tags, organizations, categories, geographic areas.
 * All descriptions preserved (no data loss).
 *
 * Triggered via POST /api/sync/catalog (protected).
 */

import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_MODEL } from "@/lib/constants";
import * as fs from "fs/promises";
import * as path from "path";

const DATAGOUV_API = "https://www.data.gouv.fr/api/1";

const DATA_DIR = () => path.join(process.cwd(), "data");
const STORE_PATH = () => path.join(DATA_DIR(), "store.json");
const CATALOG_PATH = () => path.join(DATA_DIR(), "catalog.json");

const MAX_DESC_LENGTH = 500;
const ENRICHMENT_BATCH_SIZE = 10;   // datasets per Mistral call
const ENRICHMENT_CONCURRENCY = 5;   // 5 concurrent (Mistral limit: 6 req/s)
const ENRICHMENT_DELAY_MS = 200;    // ms between mega-batch rounds
const ENRICHMENT_RETRY_DELAY_MS = 3000; // ms before retrying failed batches
const MAX_ENRICHMENTS_PER_RUN = 100_000;
const SAVE_CHECKPOINT_EVERY = 500;

// ── Logging helpers ──────────────────────────────────────────────

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const BG_GREEN = "\x1b[42m\x1b[30m";
const BG_RED = "\x1b[41m\x1b[37m";
const BG_CYAN = "\x1b[46m\x1b[30m";
const BG_MAGENTA = "\x1b[45m\x1b[37m";
const BG_YELLOW = "\x1b[43m\x1b[30m";

function progressBar(pct: number, width = 30): string {
  const filled = Math.round(width * pct / 100);
  const empty = width - filled;
  const bar = `${GREEN}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET}`;
  return bar;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm.toString().padStart(2, "0")}m`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR");
}

function logHeader(title: string) {
  const line = "═".repeat(62);
  console.log(`\n${CYAN}╔${line}╗${RESET}`);
  console.log(`${CYAN}║${RESET}  ${BOLD}${title.padEnd(60)}${RESET}${CYAN}║${RESET}`);
  console.log(`${CYAN}╚${line}╝${RESET}`);
}

function logSection(icon: string, text: string) {
  console.log(`\n${BOLD}${icon} ${text}${RESET}`);
  console.log(`${DIM}${"─".repeat(64)}${RESET}`);
}

function logStep(icon: string, text: string) {
  console.log(`  ${icon} ${text}`);
}

function logSuccess(text: string) {
  console.log(`  ${BG_GREEN} OK ${RESET} ${GREEN}${text}${RESET}`);
}

function logWarn(text: string) {
  console.log(`  ${BG_YELLOW} !! ${RESET} ${YELLOW}${text}${RESET}`);
}

function logError(text: string) {
  console.log(`  ${BG_RED} ERR ${RESET} ${RED}${text}${RESET}`);
}

interface EnrichmentStats {
  enriched: number;
  failed: number;
  retried: number;
  retrySuccess: number;
  total: number;
  startTime: number;
}

function logEnrichmentProgress(stats: EnrichmentStats, batchNum: number, totalBatches: number) {
  const pct = stats.total > 0 ? (stats.enriched + stats.failed) / stats.total * 100 : 0;
  const elapsed = Date.now() - stats.startTime;
  const speed = elapsed > 0 ? (stats.enriched / (elapsed / 1000)) : 0;
  const remaining = speed > 0 ? (stats.total - stats.enriched - stats.failed) / speed * 1000 : 0;

  const bar = progressBar(pct);
  const pctStr = pct.toFixed(1).padStart(5);

  console.log(
    `\n  ${bar} ${BOLD}${pctStr}%${RESET}  ${DIM}batch ${batchNum}/${totalBatches}${RESET}`
  );
  console.log(
    `  ${GREEN}✓ ${formatNumber(stats.enriched)}${RESET} enrichis  ` +
    `${RED}✗ ${stats.failed}${RESET} echecs  ` +
    `${YELLOW}↻ ${stats.retried}${RESET} retries ${stats.retrySuccess > 0 ? `${DIM}(${stats.retrySuccess} recuperes)${RESET}` : ""}`
  );
  console.log(
    `  ${CYAN}⚡ ${speed.toFixed(1)} items/s${RESET}  ` +
    `${BLUE}⏱ ${formatDuration(elapsed)}${RESET} elapsed  ` +
    `${MAGENTA}⏳ ~${formatDuration(remaining)}${RESET} restant`
  );
}

// ── Public Types (exported for frontend) ──────────────────────────

export interface CatalogItem {
  id: string;
  title: string;
  organization: string;
  type: "dataset" | "dataservice";
  tags: string[];
  views?: number;
  downloads?: number;
  reuses?: number;
  followers?: number;
  license?: string;
  frequency?: string;
  lastModified?: string;
  baseApiUrl?: string;
  // Enrichment fields (from Mistral)
  summary?: string;
  geo?: string;       // national | regional | departemental | communal
  geoArea?: string;   // Île-de-France, Paris, etc.
  themes?: string[];
  quality?: number;   // 1-5
  // Sub-subcategory (level 3, from Mistral → normalized)
  sub2?: string;
  sub2Label?: string;
}

export interface CatalogSubSubCategory {
  slug: string;
  label: string;
  count: number;
}

export interface CatalogSubCategory {
  slug: string;
  label: string;
  items: CatalogItem[];
  children?: CatalogSubSubCategory[];  // level-3 groups (if taxonomy normalized)
}

export interface CatalogCategory {
  slug: string;
  label: string;
  description: string;
  color: string;
  subcategories: CatalogSubCategory[];
  totalItems: number;
  totalDatasets: number;
  totalDataservices: number;
}

export interface CatalogTag {
  name: string;
  count: number;
}

export interface TopDataset {
  id: string;
  title: string;
  organization: string;
  views: number;
  downloads: number;
  reuses: number;
}

export interface CategoryStats {
  slug: string;
  label: string;
  color: string;
  totalViews: number;
  totalDownloads: number;
  totalReuses: number;
  totalItems: number;
}

export interface GeoRegion {
  slug: string;
  label: string;
  scope: string;   // national | regional | departemental | communal
  count: number;
}

export interface Catalog {
  lastSync: string;
  categories: CatalogCategory[];
  tags: CatalogTag[];
  topDatasets: TopDataset[];
  categoryStats: CategoryStats[];
  geoRegions: GeoRegion[];
  stats: {
    totalDatasets: number;
    totalDataservices: number;
    totalCategories: number;
    totalTags: number;
    totalViews: number;
    totalDownloads: number;
    totalReuses: number;
    enrichedCount: number;
    enrichmentProgress: number; // 0-100
  };
}

// ── Internal Types ────────────────────────────────────────────────

interface StoredEnrichment {
  cat: string;     // category slug
  sub: string;     // subcategory (free text, normalized later)
  sub2?: string;   // sub-subcategory (free text, normalized later)
  geo: string;     // geographic scope
  area?: string;   // geographic area name
  sum: string;     // summary
  th: string[];    // themes
  q: number;       // quality 1-5
  at: string;      // enriched at (ISO)
}

interface StoredDataset {
  id: string;
  title: string;
  org: string;
  type: "d" | "a";  // dataset or API
  tags: string[];
  v: number;         // views
  dl: number;        // downloads
  r: number;         // reuses
  f: number;         // followers
  lic?: string;      // license
  freq?: string;     // frequency
  mod?: string;      // last modified
  url?: string;      // base API URL (dataservices)
  desc?: string;     // description (first 500 chars, preserved)
  e?: StoredEnrichment;
  ef?: number;       // enrichment fail count (skip if > 2)
}

interface Store {
  v: number;          // version
  fetchedAt?: string; // last API fetch timestamp
  ds: Record<string, StoredDataset>;
}

// ── Hardcoded Taxonomy ────────────────────────────────────────────
// Stable categories for French open data. Used for:
// 1. Tag-based fallback categorization (when not yet enriched by Mistral)
// 2. Validation of Mistral category assignments
// 3. Providing the category list to Mistral in enrichment prompts

const TAXONOMY: { slug: string; label: string; description: string; tags: string[] }[] = [
  {
    slug: "environnement",
    label: "Environnement & Ecologie",
    description: "Biodiversite, eau, air, dechets, pollution, climat et developpement durable",
    tags: [
      "environnement", "ecologie", "biodiversite", "eau", "air", "dechets",
      "pollution", "climat", "nature", "faune", "flore", "foret", "parc",
      "zone-naturelle", "espaces-naturels", "risques-naturels", "inondation",
      "qualite-de-l-air", "qualite-de-leau", "emission", "co2", "gaz-a-effet-de-serre",
      "developpement-durable", "mer", "ocean", "littoral", "riviere", "fleuve",
      "lac", "zone-humide", "sol", "bruit", "assainissement", "recyclage",
      "changement-climatique", "meteorologie", "meteo", "pluviometrie",
      "temperature", "vent", "secheresse", "erosion", "natura-2000", "znieff",
      "icpe", "sites-pollues", "nappes", "eaux-souterraines", "eaux-de-surface",
    ],
  },
  {
    slug: "transport-mobilite",
    label: "Transport & Mobilite",
    description: "Transports en commun, mobilite, routes, velos, trains, circulation",
    tags: [
      "transport", "mobilite", "velo", "bus", "train", "voiture", "circulation",
      "trafic", "route", "autoroute", "gare", "aeroport", "metro", "tramway",
      "stationnement", "parking", "covoiturage", "piste-cyclable", "itineraire",
      "accident", "securite-routiere", "transport-en-commun", "transports",
      "mobilites", "sncf", "ratp", "ter", "tgv", "aviation", "port", "maritime",
      "fluvial", "taxi", "vtc", "trottinette", "bornes-de-recharge",
      "vehicule-electrique", "immatriculation", "gtfs", "reseau",
    ],
  },
  {
    slug: "sante",
    label: "Sante",
    description: "Sante publique, hopitaux, medicaments, epidemies, vaccination",
    tags: [
      "sante", "hopital", "medicament", "covid", "vaccination", "epidemie",
      "maladie", "mortalite", "natalite", "deces", "medecin", "pharmacie",
      "urgences", "ars", "assurance-maladie", "handicap", "sante-publique",
      "covid-19", "coronavirus", "pandemie", "depistage", "cancer", "diabete",
      "ehpad", "maison-de-retraite", "professionnels-de-sante",
      "hospitalisation", "soins", "clinique", "laboratoire",
    ],
  },
  {
    slug: "education-recherche",
    label: "Education & Recherche",
    description: "Ecoles, universites, formation, recherche scientifique",
    tags: [
      "education", "ecole", "universite", "recherche", "etudiant", "formation",
      "enseignement", "college", "lycee", "primaire", "maternelle", "bac",
      "diplome", "enseignement-superieur", "cnrs", "these", "publication",
      "science", "innovation", "campus", "academie", "rectorat", "scolaire",
      "parcoursup", "orientation", "cantine", "creche", "periscolaire",
    ],
  },
  {
    slug: "economie-emploi",
    label: "Economie & Emploi",
    description: "Activite economique, emploi, entreprises, commerce, chomage",
    tags: [
      "economie", "emploi", "entreprise", "commerce", "chomage", "pib",
      "industrie", "pme", "startup", "artisanat", "marche-du-travail",
      "salaire", "remuneration", "pole-emploi", "insertion", "travail",
      "formation-professionnelle", "competences", "metier",
      "auto-entrepreneur", "siret", "siren", "sirene", "rcs",
      "creation-entreprise", "exportation", "importation", "douane",
      "conjoncture", "inflation", "prix", "consommation",
      "marche-public", "commande-publique", "subvention", "aide",
      "economie-sociale-et-solidaire",
    ],
  },
  {
    slug: "logement-urbanisme",
    label: "Logement & Urbanisme",
    description: "Habitat, construction, urbanisme, immobilier, amenagement",
    tags: [
      "logement", "urbanisme", "construction", "immobilier", "habitat",
      "hlm", "logement-social", "copropriete", "renovation", "permis-de-construire",
      "plu", "plui", "scot", "zonage", "amenagement", "foncier",
      "cadastre", "parcelle", "dpe", "performance-energetique",
      "adresse", "ban", "batiment", "voirie", "quartier", "ville",
      "dvf", "valeurs-foncieres", "loyer",
    ],
  },
  {
    slug: "agriculture-alimentation",
    label: "Agriculture & Alimentation",
    description: "Agriculture, elevage, alimentation, securite alimentaire",
    tags: [
      "agriculture", "alimentation", "bio", "elevage", "cereale", "vin",
      "viticulture", "exploitation-agricole", "pac", "agroalimentaire",
      "pesticide", "phytosanitaire", "securite-alimentaire", "nutrition",
      "label", "aoc", "aop", "igp", "terroir", "abattoir", "veterinaire",
      "sylviculture", "semence", "irrigation", "foncier-agricole",
    ],
  },
  {
    slug: "culture-patrimoine",
    label: "Culture & Patrimoine",
    description: "Musees, bibliotheques, monuments, spectacles, arts",
    tags: [
      "culture", "patrimoine", "musee", "bibliotheque", "monument",
      "archeologie", "festival", "spectacle", "cinema", "theatre",
      "musique", "art", "exposition", "monument-historique", "archives",
      "livre", "lecture", "mediatheque", "conservatoire", "photographie",
      "patrimoine-mondial", "unesco",
    ],
  },
  {
    slug: "justice-securite",
    label: "Justice & Securite",
    description: "Justice, forces de l'ordre, criminalite, securite publique",
    tags: [
      "justice", "securite", "police", "gendarmerie", "crime", "delinquance",
      "prison", "tribunal", "juridiction", "penal", "civil", "contentieux",
      "droit", "loi", "legislation", "reglementation", "jurisprudence",
      "incendie", "pompier", "sdis", "secours", "risque", "prevention",
      "infraction", "amende", "violence",
    ],
  },
  {
    slug: "collectivites-administration",
    label: "Collectivites & Administration",
    description: "Communes, departements, regions, services publics, etat civil",
    tags: [
      "administration", "collectivite", "commune", "departement", "region",
      "mairie", "prefecture", "service-public", "etat-civil", "population",
      "recensement", "demographie", "naissance", "mariage",
      "cog", "insee", "code-officiel-geographique", "epci",
      "intercommunalite", "deliberation", "conseil-municipal",
      "fonction-publique", "organigramme", "annuaire",
      "transparence", "open-data", "opendata", "donnees-ouvertes",
    ],
  },
  {
    slug: "finances-fiscalite",
    label: "Finances & Fiscalite",
    description: "Budget public, fiscalite, impots, dette, comptes publics",
    tags: [
      "finance", "budget", "fiscalite", "impot", "taxe", "dette",
      "comptabilite", "recette", "depense", "investissement",
      "dotation", "tresor", "banque", "credit", "epargne", "assurance",
      "taxe-fonciere", "taxe-habitation", "finances-publiques",
      "finances-locales", "dgfip",
    ],
  },
  {
    slug: "geographie-cartographie",
    label: "Geographie & Cartographie",
    description: "Cartes, SIG, cadastre, geodonnees, referentiels geographiques",
    tags: [
      "geographie", "cartographie", "cadastre", "sig", "gis",
      "geolocalisation", "coordonnees", "carte", "plan", "topographie",
      "altitude", "relief", "ign", "ortho", "orthophotographie",
      "satellite", "lidar", "rpg", "occupation-du-sol", "corine-land-cover",
      "osm", "openstreetmap", "geojson", "shapefile", "wms", "wfs",
      "inspire", "referentiel", "ban", "bano", "iris",
      "limite-administrative", "contour",
    ],
  },
  {
    slug: "energie",
    label: "Energie",
    description: "Production et consommation d'energie, renouvelables, nucleaire",
    tags: [
      "energie", "electricite", "gaz", "nucleaire", "renouvelable",
      "solaire", "eolien", "photovoltaique", "hydraulique", "biomasse",
      "petrole", "carburant", "chauffage", "isolation",
      "renovation-energetique", "consommation-energetique", "rte",
      "enedis", "grdf", "edf", "centrale", "reseau-electrique",
      "compteur", "linky", "transition-energetique",
    ],
  },
  {
    slug: "social-solidarite",
    label: "Social & Solidarite",
    description: "Action sociale, solidarite, inclusion, pauvrete, associations",
    tags: [
      "social", "solidarite", "pauvrete", "inclusion", "association",
      "allocation", "rsa", "apl", "caf", "aide-sociale", "minima-sociaux",
      "precarite", "exclusion", "egalite", "diversite", "discrimination",
      "enfance", "protection-de-lenfance", "famille", "petite-enfance",
      "personne-agee", "autonomie", "dependance", "accessibilite",
      "migration", "refugie", "asile", "immigration", "benevolat",
    ],
  },
  {
    slug: "tourisme-loisirs-sport",
    label: "Tourisme, Loisirs & Sport",
    description: "Tourisme, equipements sportifs, loisirs, hebergements",
    tags: [
      "tourisme", "loisirs", "sport", "camping", "randonnee",
      "hotel", "hebergement", "restaurant", "equipement-sportif",
      "piscine", "stade", "competition", "club", "licence",
      "jeux-olympiques", "plage", "montagne", "ski", "sentier",
      "office-de-tourisme", "frequentation", "evenement", "agenda",
    ],
  },
  {
    slug: "numerique-technologie",
    label: "Numerique & Technologie",
    description: "Infrastructures numeriques, telecoms, couverture, donnees ouvertes",
    tags: [
      "numerique", "informatique", "telecom", "internet", "fibre",
      "4g", "5g", "couverture-mobile", "wifi", "haut-debit",
      "tres-haut-debit", "cybersecurite", "rgpd", "api",
      "interoperabilite", "logiciel-libre", "open-source",
      "intelligence-artificielle", "ia", "blockchain", "iot",
    ],
  },
  {
    slug: "elections-democratie",
    label: "Elections & Democratie",
    description: "Elections, resultats electoraux, vie politique, participation citoyenne",
    tags: [
      "election", "vote", "scrutin", "referendum", "democratie",
      "presidentielle", "legislative", "municipale", "departementale",
      "regionale", "europeenne", "bureau-de-vote", "electeur",
      "candidat", "resultat-electoral", "participation", "abstention",
      "assemblee-nationale", "senat", "depute", "senateur", "maire",
      "elu", "mandat", "petition", "consultation", "concertation",
    ],
  },
  {
    slug: "divers",
    label: "Divers",
    description: "Autres donnees et jeux de donnees non classes",
    tags: [],
  },
];

const CATEGORY_SLUGS = TAXONOMY.map((c) => c.slug).filter((s) => s !== "divers");

const CATEGORY_COLORS = [
  "blue", "emerald", "violet", "amber", "rose", "cyan",
  "orange", "indigo", "teal", "pink", "lime", "fuchsia",
  "sky", "red", "green", "slate", "zinc", "stone",
];

// ── Fixed Subcategories ─────────────────────────────────────────
// Each category has 4-9 fixed subcategories. Mistral picks from these slugs.
// `kw` is used to map old free-text enrichments to the correct fixed slug.

const SUBCATEGORIES: Record<string, { slug: string; label: string; kw: string[] }[]> = {
  "environnement": [
    { slug: "qualite-air", label: "Qualite de l'air & emissions", kw: ["air", "emission", "co2", "gaz-a-effet", "atmosphere", "polluant", "particule", "ozone"] },
    { slug: "eau-ressources", label: "Eau & ressources hydriques", kw: ["eau", "riviere", "fleuve", "lac", "nappe", "assainissement", "eaux-souterraine", "eaux-de-surface", "hydrologie", "hydrographie"] },
    { slug: "biodiversite", label: "Biodiversite, faune & flore", kw: ["biodiversite", "faune", "flore", "espece", "oiseau", "poisson", "animal", "vegetal", "habitat", "natura", "znieff"] },
    { slug: "dechets-recyclage", label: "Dechets & recyclage", kw: ["dechet", "recyclage", "tri", "compost", "ordure", "collecte", "dechetterie", "valorisation"] },
    { slug: "climat-meteo", label: "Climat & meteorologie", kw: ["climat", "meteo", "temperature", "pluviometrie", "vent", "secheresse", "precipit", "changement-climatique"] },
    { slug: "risques-naturels", label: "Risques naturels & catastrophes", kw: ["risque", "inondation", "seisme", "avalanche", "mouvement-de-terrain", "catastrophe", "crue", "submersion"] },
    { slug: "espaces-naturels", label: "Espaces naturels & forets", kw: ["foret", "parc", "reserve", "espace-naturel", "zone-protegee", "arbre", "bois", "sylviculture", "paysage"] },
    { slug: "pollution-sols", label: "Pollution & sols contamines", kw: ["pollution", "sol", "site-pollue", "icpe", "contamination", "depollution", "basias", "basol"] },
    { slug: "mer-littoral", label: "Mer, ocean & littoral", kw: ["mer", "ocean", "littoral", "cote", "plage", "maree", "maritime", "marin", "sous-marin", "erosion-cotiere"] },
  ],
  "transport-mobilite": [
    { slug: "transports-commun", label: "Transports en commun", kw: ["transport-en-commun", "bus", "metro", "tramway", "ratp", "reseau", "ligne", "arret", "gtfs", "horaire"] },
    { slug: "routes-circulation", label: "Routes & trafic routier", kw: ["route", "autoroute", "trafic", "circulation", "bouchon", "voirie", "chaussee", "national", "departementale"] },
    { slug: "mobilite-douce", label: "Velos & mobilites douces", kw: ["velo", "cyclable", "piste", "trottinette", "pieton", "marche", "mobilite-douce", "cycle", "bicyclette"] },
    { slug: "ferroviaire", label: "Train & reseau ferre", kw: ["train", "sncf", "ter", "tgv", "gare", "ferroviaire", "chemin-de-fer", "rail", "lgv", "fret"] },
    { slug: "aerien-maritime", label: "Aerien, maritime & fluvial", kw: ["aeroport", "avion", "aviation", "port", "maritime", "fluvial", "navigation", "bateau", "cargo"] },
    { slug: "stationnement", label: "Stationnement & parking", kw: ["stationnement", "parking", "parcmetre", "parc-relais", "garage", "place"] },
    { slug: "securite-routiere", label: "Accidents & securite routiere", kw: ["accident", "securite-routiere", "sinistre", "radar", "vitesse", "mortalite-routiere", "accidentologie"] },
  ],
  "sante": [
    { slug: "etablissements-sante", label: "Hopitaux & etablissements", kw: ["hopital", "clinique", "chu", "chru", "etablissement", "hospitalier", "urgence", "ars", "ehpad", "maison-de-retraite"] },
    { slug: "epidemiologie", label: "Epidemiologie & maladies", kw: ["epidemie", "maladie", "mortalite", "morbidite", "pathologie", "cancer", "diabete", "chronique", "incidence", "prevalence"] },
    { slug: "medicaments-pharmacie", label: "Medicaments & pharmacie", kw: ["medicament", "pharmacie", "ordonnance", "prescription", "principe-actif", "generique", "posologie", "ansm"] },
    { slug: "professionnels-sante", label: "Professionnels de sante", kw: ["medecin", "infirmier", "sage-femme", "dentiste", "professionnel-de-sante", "praticien", "liberal", "specialiste"] },
    { slug: "prevention-vaccination", label: "Prevention & vaccination", kw: ["vaccination", "vaccin", "prevention", "depistage", "campagne", "dose", "immunisation", "prophylaxie"] },
    { slug: "handicap-dependance", label: "Handicap & dependance", kw: ["handicap", "dependance", "autonomie", "mdph", "accessibilite", "invalidite", "aidant"] },
    { slug: "covid", label: "COVID-19 & pandemies", kw: ["covid", "coronavirus", "pandemie", "confinement", "test-pcr", "pass-sanitaire", "sars-cov"] },
  ],
  "education-recherche": [
    { slug: "etablissements-scolaires", label: "Etablissements scolaires", kw: ["ecole", "college", "lycee", "maternelle", "primaire", "etablissement-scolaire", "academie", "rectorat"] },
    { slug: "enseignement-superieur", label: "Enseignement superieur", kw: ["universite", "fac", "iut", "bts", "master", "licence", "campus", "enseignement-superieur", "parcoursup"] },
    { slug: "recherche-scientifique", label: "Recherche scientifique", kw: ["recherche", "cnrs", "inrae", "inserm", "these", "publication", "laboratoire", "science", "innovation"] },
    { slug: "formation-pro", label: "Formation professionnelle", kw: ["formation", "apprentissage", "alternance", "competence", "certification", "cpf", "opco", "cfa"] },
    { slug: "vie-scolaire", label: "Vie scolaire & periscolaire", kw: ["cantine", "periscolaire", "creche", "garderie", "rythme-scolaire", "transport-scolaire", "internat"] },
    { slug: "diplomes-examens", label: "Diplomes & examens", kw: ["diplome", "bac", "brevet", "examen", "resultat", "concours", "orientation", "reussite"] },
  ],
  "economie-emploi": [
    { slug: "emploi-chomage", label: "Emploi & chomage", kw: ["emploi", "chomage", "pole-emploi", "demandeur", "offre", "marche-du-travail", "taux-de-chomage", "actif"] },
    { slug: "entreprises-registre", label: "Entreprises & registre", kw: ["entreprise", "siret", "siren", "sirene", "rcs", "creation-entreprise", "societe", "auto-entrepreneur", "immatriculation"] },
    { slug: "commerce-artisanat", label: "Commerce & artisanat", kw: ["commerce", "artisan", "boutique", "magasin", "marche", "foire", "commercant", "metier-d-art"] },
    { slug: "marches-publics", label: "Marches publics & commande publique", kw: ["marche-public", "commande-publique", "appel-d-offre", "attribution", "subvention", "aide", "detr", "dsil"] },
    { slug: "conjoncture-prix", label: "Conjoncture, prix & inflation", kw: ["prix", "inflation", "indice", "conjoncture", "consommation", "ipc", "pouvoir-d-achat", "salaire", "remuneration"] },
    { slug: "import-export", label: "Import, export & douanes", kw: ["import", "export", "douane", "echange", "balance-commerciale", "frontiere", "tarif"] },
    { slug: "economie-sociale", label: "Economie sociale & solidaire", kw: ["ess", "cooperative", "mutuelle", "economie-sociale", "insertion", "solidaire"] },
  ],
  "logement-urbanisme": [
    { slug: "urbanisme-plu", label: "Documents d'urbanisme", kw: ["plu", "plui", "scot", "zonage", "urbanisme", "reglementation", "plan-local", "amenagement"] },
    { slug: "logement-social", label: "Logement social", kw: ["hlm", "logement-social", "bailleur", "loyer", "attribution", "demande-de-logement", "office"] },
    { slug: "foncier-cadastre", label: "Foncier & cadastre", kw: ["cadastre", "parcelle", "foncier", "propriete", "terrain", "section", "plan-cadastral"] },
    { slug: "construction", label: "Construction & permis", kw: ["construction", "permis-de-construire", "batiment", "chantier", "renovation", "travaux", "demolition"] },
    { slug: "adresses-voirie", label: "Adresses & voirie", kw: ["adresse", "ban", "bano", "voie", "voirie", "rue", "numero", "geolocalisation-adresse"] },
    { slug: "valeurs-foncieres", label: "Valeurs foncieres & immobilier", kw: ["dvf", "valeur-fonciere", "immobilier", "transaction", "vente", "prix-immobilier", "notaire", "dpe", "performance-energetique"] },
  ],
  "agriculture-alimentation": [
    { slug: "exploitations-agricoles", label: "Exploitations agricoles", kw: ["exploitation", "agriculteur", "ferme", "pac", "surface", "parcelle-agricole", "rpg"] },
    { slug: "productions-vegetales", label: "Cultures & productions vegetales", kw: ["cereale", "culture", "recolte", "semence", "irrigation", "blé", "mais", "tournesol", "legume"] },
    { slug: "elevage", label: "Elevage & productions animales", kw: ["elevage", "bovin", "ovin", "porcin", "volaille", "lait", "viande", "abattoir", "cheptel"] },
    { slug: "securite-alimentaire", label: "Securite alimentaire & nutrition", kw: ["securite-alimentaire", "hygiene", "controle", "rappel", "contamination", "nutrition", "additif"] },
    { slug: "labels-terroir", label: "Labels, AOC & terroir", kw: ["label", "aoc", "aop", "igp", "bio", "terroir", "appellation", "certification", "qualite"] },
    { slug: "peche-aquaculture", label: "Peche & aquaculture", kw: ["peche", "aquaculture", "poisson", "criee", "maree", "conchyliculture", "halieutique"] },
  ],
  "culture-patrimoine": [
    { slug: "musees", label: "Musees & expositions", kw: ["musee", "exposition", "collection", "oeuvre", "galerie", "visite", "beaux-arts"] },
    { slug: "bibliotheques", label: "Bibliotheques & lecture", kw: ["bibliotheque", "mediatheque", "livre", "lecture", "pret", "catalogue", "emprunt"] },
    { slug: "monuments-patrimoine", label: "Monuments & patrimoine", kw: ["monument", "patrimoine", "historique", "chateau", "eglise", "cathedrale", "archeologie", "unesco"] },
    { slug: "spectacles-festivals", label: "Spectacles & festivals", kw: ["spectacle", "festival", "concert", "theatre", "cinema", "musique", "scene", "representation"] },
    { slug: "archives", label: "Archives & documentation", kw: ["archive", "document", "historique", "fonds", "inventaire", "numerisation", "memoire"] },
  ],
  "justice-securite": [
    { slug: "criminalite", label: "Criminalite & delinquance", kw: ["crime", "delinquance", "infraction", "vol", "violence", "cambriolage", "statistique-criminelle"] },
    { slug: "tribunaux-justice", label: "Tribunaux & justice", kw: ["tribunal", "cour", "juridiction", "justice", "jugement", "contentieux", "civil", "penal", "avocat"] },
    { slug: "securite-civile", label: "Securite civile & secours", kw: ["pompier", "incendie", "sdis", "secours", "intervention", "sapeur", "caserne", "urgence-112"] },
    { slug: "legislation", label: "Legislation & reglementation", kw: ["loi", "decret", "arrete", "reglementation", "legislation", "code", "jurisprudence", "norme"] },
    { slug: "prevention-risques", label: "Prevention des risques", kw: ["prevention", "risque", "securite", "plan-de-prevention", "pprn", "pprt", "seveso", "vigilance"] },
  ],
  "collectivites-administration": [
    { slug: "communes-interco", label: "Communes & intercommunalites", kw: ["commune", "intercommunalite", "epci", "mairie", "conseil-municipal", "deliberation", "communaute"] },
    { slug: "services-publics", label: "Services publics", kw: ["service-public", "guichet", "demarche", "accueil", "prefecture", "sous-prefecture", "administration"] },
    { slug: "etat-civil", label: "Etat civil & demographie", kw: ["etat-civil", "naissance", "deces", "mariage", "population", "recensement", "demographie", "habitant"] },
    { slug: "open-data", label: "Open data & transparence", kw: ["open-data", "opendata", "donnees-ouvertes", "transparence", "reutilisation", "licence", "catalogue"] },
    { slug: "fonction-publique", label: "Fonction publique & agents", kw: ["fonction-publique", "fonctionnaire", "agent", "effectif", "organigramme", "annuaire", "concours-administratif"] },
  ],
  "finances-fiscalite": [
    { slug: "budget-comptes", label: "Budget & comptes publics", kw: ["budget", "compte", "depense", "recette", "comptabilite", "exercice", "bilan", "tresor"] },
    { slug: "fiscalite", label: "Fiscalite & impots", kw: ["impot", "taxe", "fiscal", "contribution", "tva", "irpp", "is", "cotisation", "redevance"] },
    { slug: "finances-locales", label: "Finances locales", kw: ["finances-locales", "budget-communal", "budget-local", "dotation", "dgf", "collectivite", "commune"] },
    { slug: "dotations", label: "Dotations & transferts", kw: ["dotation", "subvention", "transfert", "detr", "dsil", "fctva", "peréquation"] },
    { slug: "banque-assurance", label: "Banque, credit & assurance", kw: ["banque", "credit", "epargne", "assurance", "pret", "taux", "emprunt", "placement"] },
  ],
  "geographie-cartographie": [
    { slug: "limites-admin", label: "Limites administratives", kw: ["limite", "contour", "frontiere", "decoupage", "administratif", "canton", "arrondissement", "iris"] },
    { slug: "occupation-sols", label: "Occupation des sols", kw: ["occupation-du-sol", "corine", "ocsge", "artificialisation", "usage", "couverture"] },
    { slug: "ortho-imagerie", label: "Orthophotographie & imagerie", kw: ["ortho", "photo", "satellite", "imagerie", "lidar", "mnt", "mns", "aerien"] },
    { slug: "adresses-ref", label: "Adresses & referentiels", kw: ["adresse", "ban", "bano", "referentiel", "geocodage", "cog", "code-officiel", "nomenclature"] },
    { slug: "topographie-relief", label: "Topographie & relief", kw: ["topographie", "relief", "altitude", "courbe-de-niveau", "elevation", "mnt", "ign"] },
    { slug: "sig-geodonnees", label: "SIG & donnees geographiques", kw: ["sig", "gis", "geojson", "shapefile", "wms", "wfs", "inspire", "geoportail", "coordonnee", "geomatique"] },
  ],
  "energie": [
    { slug: "electricite", label: "Electricite & reseaux", kw: ["electricite", "enedis", "rte", "edf", "reseau-electrique", "poste", "transformateur", "compteur", "linky"] },
    { slug: "gaz-petrole", label: "Gaz, petrole & carburants", kw: ["gaz", "petrole", "carburant", "essence", "diesel", "grdf", "station-service", "fioul", "gpl"] },
    { slug: "renouvelables", label: "Energies renouvelables", kw: ["renouvelable", "solaire", "eolien", "photovoltaique", "hydraulique", "biomasse", "geothermie", "biocarburant"] },
    { slug: "consommation-energie", label: "Consommation energetique", kw: ["consommation", "performance", "dpe", "isolation", "chauffage", "bilan-energetique", "certificat"] },
    { slug: "nucleaire", label: "Nucleaire", kw: ["nucleaire", "centrale", "reacteur", "asn", "radioactivite", "demantelement", "combustible"] },
  ],
  "social-solidarite": [
    { slug: "aides-prestations", label: "Aides & prestations sociales", kw: ["aide", "allocation", "rsa", "apl", "aah", "caf", "prestation", "minimum", "social"] },
    { slug: "pauvrete-exclusion", label: "Pauvrete & precarite", kw: ["pauvrete", "precarite", "exclusion", "sdf", "sans-abri", "hebergement-urgence", "samu-social"] },
    { slug: "enfance-famille", label: "Enfance & famille", kw: ["enfance", "famille", "protection", "adoption", "garde", "pmi", "petite-enfance", "allocataire"] },
    { slug: "personnes-agees", label: "Personnes agees & autonomie", kw: ["personne-agee", "senior", "retraite", "apa", "dependance", "ehpad", "maison-de-retraite"] },
    { slug: "associations", label: "Associations & benevolat", kw: ["association", "loi-1901", "benevolat", "fondation", "ong", "mecenat", "vie-associative"] },
    { slug: "migration", label: "Migration & integration", kw: ["migration", "refugie", "asile", "immigration", "integration", "etranger", "titre-de-sejour", "naturalisation"] },
  ],
  "tourisme-loisirs-sport": [
    { slug: "hebergements", label: "Hebergements touristiques", kw: ["hotel", "camping", "gite", "hebergement", "chambre-d-hote", "meuble", "auberge", "residence"] },
    { slug: "equipements-sportifs", label: "Equipements sportifs", kw: ["equipement", "stade", "piscine", "gymnase", "terrain", "salle-de-sport", "complexe-sportif"] },
    { slug: "randonnee-plein-air", label: "Randonnee & plein air", kw: ["randonnee", "sentier", "gr", "itineraire", "balade", "plein-air", "montagne", "ski", "escalade"] },
    { slug: "evenements", label: "Evenements & agenda", kw: ["evenement", "agenda", "manifestation", "salon", "competition", "course", "tournoi", "fete"] },
    { slug: "frequentation-tourisme", label: "Frequentation touristique", kw: ["frequentation", "touriste", "visiteur", "nuitee", "office-de-tourisme", "saison", "destination"] },
  ],
  "numerique-technologie": [
    { slug: "couverture-reseaux", label: "Couverture & reseaux telecom", kw: ["couverture", "fibre", "4g", "5g", "haut-debit", "reseau", "telecom", "antenne", "mobile"] },
    { slug: "services-numeriques", label: "Services numeriques", kw: ["service-numerique", "application", "plateforme", "api", "portail", "dematerialisation", "e-administration"] },
    { slug: "cybersecurite", label: "Cybersecurite & RGPD", kw: ["cybersecurite", "rgpd", "donnees-personnelles", "cnil", "protection", "securite-informatique"] },
    { slug: "logiciel-libre", label: "Logiciel libre & open source", kw: ["logiciel-libre", "open-source", "code-source", "depot", "github", "forge", "commun-numerique"] },
  ],
  "elections-democratie": [
    { slug: "resultats", label: "Resultats electoraux", kw: ["resultat", "scrutin", "voix", "suffrage", "ballottage", "elu", "score", "tour"] },
    { slug: "bureaux-vote", label: "Bureaux de vote & decoupage", kw: ["bureau-de-vote", "decoupage", "circonscription", "electeur", "liste-electorale", "carte-electorale"] },
    { slug: "elus-mandats", label: "Elus & mandats", kw: ["elu", "maire", "depute", "senateur", "conseiller", "mandat", "assemblee", "senat", "conseil"] },
    { slug: "participation-citoyenne", label: "Participation citoyenne", kw: ["participation", "consultation", "concertation", "petition", "referendum", "citoyen", "debat-public"] },
  ],
  "divers": [
    { slug: "general", label: "General", kw: [] },
  ],
};

// ── Taxonomy Normalization System ─────────────────────────────────
// After enrichment, Mistral clusters free-text subcategories into canonical groups.
// This mapping is stored in data/taxonomy.json and used during catalog build.

interface TaxonomyGroup {
  slug: string;
  label: string;
  members: string[];           // original sub/sub2 values that map to this group
  children?: TaxonomyGroup[];  // level-3 sub-subcategory groups
}

interface TaxonomyMapping {
  v: number;
  builtAt: string;
  categories: Record<string, TaxonomyGroup[]>;  // catSlug → level-2 groups
}

const TAXONOMY_PATH = () => path.join(DATA_DIR(), "taxonomy.json");

async function loadTaxonomy(): Promise<TaxonomyMapping | null> {
  try {
    const raw = await fs.readFile(TAXONOMY_PATH(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTaxonomy(mapping: TaxonomyMapping): Promise<void> {
  await fs.mkdir(DATA_DIR(), { recursive: true });
  await fs.writeFile(TAXONOMY_PATH(), JSON.stringify(mapping, null, 2), "utf-8");
}

/**
 * Find the canonical subcategory group for a raw sub value.
 * Falls back to creating a group from the raw value if no mapping exists.
 */
function findCanonicalGroup(
  taxonomy: TaxonomyMapping | null,
  catSlug: string,
  rawSub: string
): { slug: string; label: string } {
  if (!taxonomy?.categories[catSlug]) {
    return { slug: normalizeSlug(rawSub), label: rawSub };
  }

  const groups = taxonomy.categories[catSlug];
  const rawNorm = rawSub.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // Exact member match
  for (const group of groups) {
    for (const member of group.members) {
      const memberNorm = member.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (rawNorm === memberNorm) return { slug: group.slug, label: group.label };
    }
    // Also match by slug
    if (normalizeSlug(rawSub) === group.slug) return { slug: group.slug, label: group.label };
  }

  // Fuzzy: check if raw contains or is contained by any member
  for (const group of groups) {
    for (const member of group.members) {
      const memberNorm = member.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (rawNorm.length > 4 && memberNorm.length > 4) {
        if (rawNorm.includes(memberNorm) || memberNorm.includes(rawNorm)) {
          return { slug: group.slug, label: group.label };
        }
      }
    }
  }

  return { slug: normalizeSlug(rawSub), label: rawSub };
}

/**
 * Find canonical sub-subcategory (level 3) within a subcategory group.
 */
function findCanonicalSub2(
  taxonomy: TaxonomyMapping | null,
  catSlug: string,
  subSlug: string,
  rawSub2: string
): { slug: string; label: string } | null {
  if (!rawSub2 || !taxonomy?.categories[catSlug]) return null;

  const groups = taxonomy.categories[catSlug];
  const parentGroup = groups.find((g) => g.slug === subSlug);
  if (!parentGroup?.children) return { slug: normalizeSlug(rawSub2), label: rawSub2 };

  const rawNorm = rawSub2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  for (const child of parentGroup.children) {
    for (const member of child.members) {
      const memberNorm = member.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (rawNorm === memberNorm || normalizeSlug(rawSub2) === child.slug) {
        return { slug: child.slug, label: child.label };
      }
    }
  }

  return { slug: normalizeSlug(rawSub2), label: rawSub2 };
}

/**
 * Build an optimal taxonomy by having Mistral cluster all free-text subcategories.
 * Run AFTER enrichment is sufficiently complete (e.g., >50% enriched).
 *
 * **Incremental mode** (default when taxonomy.json exists):
 *   - Loads existing taxonomy, finds NEW sub/sub2 values not yet mapped
 *   - Categories with <5 new subs: assigns them to best-matching existing group or "autres"
 *   - Categories with >=5 new subs: re-clusters only that category via Mistral Large
 *   - Categories with 0 new subs: kept as-is (no Mistral call)
 *
 * **Full mode** (no existing taxonomy, or force=true):
 *   - Clusters ALL subcategories from scratch via Mistral Large
 *
 * Result saved to data/taxonomy.json and used in subsequent catalog builds.
 */
async function normalizeTaxonomy(store: Store, model?: string, force?: boolean): Promise<TaxonomyMapping> {
  const normModel = model || "mistral-large-latest";
  const enriched = Object.values(store.ds).filter((d) => d.e);
  logStep("🔬", `Analyse de ${formatNumber(enriched.length)} items enrichis avec ${BOLD}${normModel}${RESET}`);

  // Try incremental mode: load existing taxonomy
  const existingTaxonomy = force ? null : await loadTaxonomy();

  // Collect sub + sub2 values per category
  const subsByCategory = new Map<
    string,
    Map<string, { count: number; sub2s: Map<string, number> }>
  >();

  for (const item of enriched) {
    const cat = item.e!.cat;
    if (!subsByCategory.has(cat)) subsByCategory.set(cat, new Map());
    const catSubs = subsByCategory.get(cat)!;

    const sub = item.e!.sub;
    if (!catSubs.has(sub)) catSubs.set(sub, { count: 0, sub2s: new Map() });
    const subData = catSubs.get(sub)!;
    subData.count++;

    if (item.e!.sub2) {
      subData.sub2s.set(item.e!.sub2, (subData.sub2s.get(item.e!.sub2) || 0) + 1);
    }
  }

  const mistral = getMistral();
  const categories: Record<string, TaxonomyGroup[]> = {};

  // Build set of already-mapped members per category from existing taxonomy
  const existingMembersByCat = new Map<string, Set<string>>();
  if (existingTaxonomy) {
    for (const [catSlug, groups] of Object.entries(existingTaxonomy.categories)) {
      const members = new Set<string>();
      for (const g of groups) {
        for (const m of g.members) members.add(m);
      }
      existingMembersByCat.set(catSlug, members);
    }
  }

  let skippedCategories = 0;
  let mergedCategories = 0;
  let reclusteredCategories = 0;

  for (const [catSlug, subs] of subsByCategory) {
    const catLabel = TAXONOMY.find((c) => c.slug === catSlug)?.label || catSlug;
    const subEntries = Array.from(subs.entries()).sort((a, b) => b[1].count - a[1].count);

    if (subEntries.length <= 2) {
      categories[catSlug] = subEntries.map(([name]) => ({
        slug: normalizeSlug(name),
        label: name,
        members: [name],
      }));
      continue;
    }

    // Incremental mode: check for new subcategories
    const existingMembers = existingMembersByCat.get(catSlug);
    const existingGroups = existingTaxonomy?.categories[catSlug];

    if (existingMembers && existingGroups && existingGroups.length > 0) {
      const newSubs = subEntries
        .map(([name]) => name)
        .filter((n) => !existingMembers.has(n));

      if (newSubs.length === 0) {
        // No new subcategories — keep existing taxonomy as-is
        categories[catSlug] = existingGroups;
        skippedCategories++;
        logStep("⏭️", `${catLabel} ${DIM}(0 nouvelles sous-cat, conserve)${RESET}`);
        continue;
      }

      if (newSubs.length < 5) {
        // Few new subs — assign to "autres" group without Mistral call
        categories[catSlug] = existingGroups.map(g => ({
          ...g,
          members: [...g.members],
          children: g.children ? g.children.map(c => ({ ...c, members: [...c.members] })) : undefined,
        }));
        const autresGroup = categories[catSlug].find((g) => g.slug === "autres");
        if (autresGroup) {
          autresGroup.members.push(...newSubs);
        } else {
          categories[catSlug].push({
            slug: "autres",
            label: "Autres",
            members: newSubs,
          });
        }
        mergedCategories++;
        logStep("➕", `${catLabel} ${DIM}(+${newSubs.length} nouvelles → autres)${RESET}`);
        continue;
      }

      // Many new subs (>=5) — re-cluster this category
      logStep("🔄", `${catLabel} ${DIM}(+${newSubs.length} nouvelles, re-clustering)${RESET}`);
      reclusteredCategories++;
    }

    // Full clustering for this category (either no existing taxonomy, force, or many new subs)
    const subList = subEntries
      .map(([name, data]) => `"${name}" (${data.count})`)
      .join(", ");

    logStep("🏷️", `${catLabel} ${DIM}(${subEntries.length} sous-cat)${RESET}`);

    try {
      const response = await mistral.chat.complete({
        model: normModel,
        messages: [
          {
            role: "user",
            content: `Tu es un expert en taxonomie des donnees ouvertes francaises.

Categorie: "${catLabel}" (${catSlug})
${subEntries.length} sous-categories trouvees dans les donnees:
${subList}

Regroupe-les en 5-12 groupes canoniques coherents. Fusionne les doublons, variantes orthographiques et concepts tres proches.

Regles:
- Chaque groupe: slug kebab-case (2-4 mots) + label clair en francais
- TOUS les membres doivent etre inclus dans un groupe
- Si une sous-categorie est unique, la mettre dans "autres"
- Ordonne par importance/frequence

JSON: {"groups":[{"slug":"qualite-air","label":"Qualite de l'air","members":["Qualite de l'air","Qualite air","Air ambiant"]}]}`,
          },
        ],
        temperature: 0.1,
        maxTokens: 3000,
        responseFormat: { type: "json_object" },
      });

      const content = response.choices?.[0]?.message?.content;
      if (content && typeof content === "string") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed: any = JSON.parse(content);
        const groups = parsed.groups || parsed.g || [];

        if (Array.isArray(groups) && groups.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          categories[catSlug] = groups.map((g: any) => ({
            slug: normalizeSlug(g.slug || g.label),
            label: String(g.label),
            members: Array.isArray(g.members) ? g.members.map(String) : [],
          }));

          // Now cluster sub2 values within each canonical group
          for (const group of categories[catSlug]) {
            const sub2Map = new Map<string, number>();
            for (const member of group.members) {
              const subData = subs.get(member);
              if (subData) {
                for (const [sub2, count] of subData.sub2s) {
                  sub2Map.set(sub2, (sub2Map.get(sub2) || 0) + count);
                }
              }
            }

            if (sub2Map.size > 3) {
              const sub2List = Array.from(sub2Map.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `"${name}" (${count})`)
                .join(", ");

              try {
                const sub2Response = await mistral.chat.complete({
                  model: normModel,
                  messages: [
                    {
                      role: "user",
                      content: `Regroupe ces sous-sous-categories de "${group.label}" en 2-6 groupes canoniques:
${sub2List}

JSON: {"groups":[{"slug":"slug-kebab","label":"Label clair","members":["m1","m2"]}]}`,
                    },
                  ],
                  temperature: 0.1,
                  maxTokens: 1500,
                  responseFormat: { type: "json_object" },
                });

                const sub2Content = sub2Response.choices?.[0]?.message?.content;
                if (sub2Content && typeof sub2Content === "string") {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const sub2Parsed: any = JSON.parse(sub2Content);
                  const sub2Groups = sub2Parsed.groups || [];
                  if (Array.isArray(sub2Groups) && sub2Groups.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    group.children = sub2Groups.map((sg: any) => ({
                      slug: normalizeSlug(sg.slug || sg.label),
                      label: String(sg.label),
                      members: Array.isArray(sg.members) ? sg.members.map(String) : [],
                    }));
                  }
                }
              } catch {
                // Skip sub2 clustering for this group
              }
            } else if (sub2Map.size > 0) {
              // Few sub2 values: each is its own group
              group.children = Array.from(sub2Map.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([name]) => ({
                  slug: normalizeSlug(name),
                  label: name,
                  members: [name],
                }));
            }
          }

          // Add a catch-all for unmapped subs
          const mappedMembers = new Set(
            categories[catSlug].flatMap((g) => g.members)
          );
          const unmapped = subEntries
            .map(([name]) => name)
            .filter((n) => !mappedMembers.has(n));
          if (unmapped.length > 0) {
            const existingAutres = categories[catSlug].find(
              (g) => g.slug === "autres"
            );
            if (existingAutres) {
              existingAutres.members.push(...unmapped);
            } else {
              categories[catSlug].push({
                slug: "autres",
                label: "Autres",
                members: unmapped,
              });
            }
          }

          const childCount = categories[catSlug].reduce((s, g) => s + (g.children?.length || 0), 0);
          logSuccess(`${catSlug}: ${categories[catSlug].length} groupes${childCount > 0 ? ` · ${childCount} sous-groupes` : ""}`);
          continue;
        }
      }
    } catch (err) {
      logError(`${catSlug}: ${err instanceof Error ? err.message : err}`);
    }

    // Fallback: each subcategory is its own group
    categories[catSlug] = subEntries.map(([name]) => ({
      slug: normalizeSlug(name),
      label: name,
      members: [name],
    }));
  }

  // Log incremental stats
  if (existingTaxonomy) {
    logStep("📊", `Incremental: ${skippedCategories} conservees, ${mergedCategories} fusionnees, ${reclusteredCategories} re-clusterisees`);
  }

  const mapping: TaxonomyMapping = {
    v: 1,
    builtAt: new Date().toISOString(),
    categories,
  };

  await saveTaxonomy(mapping);

  // Log stats
  let totalGroups = 0;
  let totalChildren = 0;
  for (const groups of Object.values(categories)) {
    totalGroups += groups.length;
    for (const g of groups) {
      totalChildren += g.children?.length || 0;
    }
  }
  console.log(
    `[taxonomy] Built: ${Object.keys(categories).length} categories, ` +
      `${totalGroups} subcategories, ${totalChildren} sub-subcategories`
  );

  return mapping;
}

// ── Store Management ──────────────────────────────────────────────

async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { v: 1, ds: {} };
  }
}

let _saving = false;
async function saveStore(store: Store): Promise<void> {
  if (_saving) return; // Prevent concurrent writes
  _saving = true;
  try {
    await fs.mkdir(DATA_DIR(), { recursive: true });
    // Atomic write: write to temp file, then rename (prevents corruption on crash)
    const tmpPath = STORE_PATH() + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(store), "utf-8");
    await fs.rename(tmpPath, STORE_PATH());
  } finally {
    _saving = false;
  }
}

// ── API Fetch ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseApiDataset(ds: any): StoredDataset {
  const rawDesc = (ds.description || "")
    .substring(0, MAX_DESC_LENGTH)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: ds.id,
    title: ds.title || "",
    org: ds.organization?.name || "",
    type: "d",
    tags: (ds.tags || []).slice(0, 10),
    v: ds.metrics?.views || 0,
    dl: ds.metrics?.resources_downloads || 0,
    r: ds.metrics?.reuses || 0,
    f: ds.metrics?.followers || 0,
    lic: ds.license || undefined,
    freq: ds.frequency || undefined,
    mod: ds.last_modified || undefined,
    desc: rawDesc || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseApiDataservice(ds: any): StoredDataset {
  const rawDesc = (ds.description || "")
    .substring(0, MAX_DESC_LENGTH)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: ds.id,
    title: ds.title || "",
    org: ds.organization?.name || "",
    type: "a",
    tags: (ds.tags || []).slice(0, 10),
    v: 0,
    dl: 0,
    r: 0,
    f: 0,
    url: ds.base_api_url || undefined,
    desc: rawDesc || undefined,
  };
}

async function fetchDatasets(store: Store): Promise<{ added: number; updated: number }> {
  console.log("[sync] Fetching datasets from data.gouv.fr...");
  let page = 1;
  let added = 0;
  let updated = 0;
  let totalExpected = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(
        `${DATAGOUV_API}/datasets/?page_size=1000&page=${page}`,
        { signal: AbortSignal.timeout(60_000) }
      );
      if (!res.ok) {
        console.error(`[sync]   Page ${page} HTTP ${res.status}, stopping`);
        break;
      }
      const json = await res.json();
      if (page === 1) totalExpected = json.total || 0;
      const data = json.data || [];
      if (data.length === 0) break;

      for (const ds of data) {
        const parsed = parseApiDataset(ds);
        if (store.ds[parsed.id]) {
          // Update metrics + description for existing
          const existing = store.ds[parsed.id];
          existing.v = parsed.v;
          existing.dl = parsed.dl;
          existing.r = parsed.r;
          existing.f = parsed.f;
          if (parsed.mod) existing.mod = parsed.mod;
          if (parsed.desc && !existing.desc) existing.desc = parsed.desc;
          updated++;
        } else {
          store.ds[parsed.id] = parsed;
          added++;
        }
      }

      const total = Object.values(store.ds).filter((d) => d.type === "d").length;
      const pct = totalExpected > 0 ? ((total / totalExpected) * 100).toFixed(0) : "?";
      console.log(`[sync]   Page ${page}: +${data.length} (${total}/${totalExpected} = ${pct}%)`);

      if (!json.next_page) break;
      page++;
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`[sync]   Error page ${page}:`, err);
      // Retry once
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(
          `${DATAGOUV_API}/datasets/?page_size=1000&page=${page}`,
          { signal: AbortSignal.timeout(60_000) }
        );
        if (res.ok) {
          const json = await res.json();
          for (const ds of json.data || []) {
            const parsed = parseApiDataset(ds);
            if (!store.ds[parsed.id]) {
              store.ds[parsed.id] = parsed;
              added++;
            }
          }
          if (!json.next_page) break;
          page++;
          continue;
        }
      } catch {
        /* skip */
      }
      break;
    }
  }

  console.log(`[sync] Datasets: +${added} new, ${updated} updated`);
  return { added, updated };
}

async function fetchDataservices(store: Store): Promise<{ added: number; updated: number }> {
  console.log("[sync] Fetching dataservices...");
  let page = 1;
  let added = 0;
  let updated = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(
        `${DATAGOUV_API}/dataservices/?page_size=100&page=${page}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      if (!res.ok) break;
      const json = await res.json();

      for (const ds of json.data || []) {
        const parsed = parseApiDataservice(ds);
        if (store.ds[parsed.id]) {
          updated++;
        } else {
          store.ds[parsed.id] = parsed;
          added++;
        }
      }

      if (!json.next_page) break;
      page++;
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      break;
    }
  }

  console.log(`[sync] Dataservices: +${added} new, ${updated} updated`);
  return { added, updated };
}

// ── Tag-based categorization (fallback for unenriched items) ──────

let _tagMap: Map<string, string> | null = null;
function getTagToCategoryMap(): Map<string, string> {
  if (_tagMap) return _tagMap;
  _tagMap = new Map();
  for (const cat of TAXONOMY) {
    for (const tag of cat.tags) {
      _tagMap.set(tag.toLowerCase(), cat.slug);
    }
  }
  return _tagMap;
}

function assignCategoryByTags(tags: string[]): string {
  const map = getTagToCategoryMap();
  const scores = new Map<string, number>();
  for (const tag of tags) {
    const cat = map.get(tag.toLowerCase());
    if (cat) scores.set(cat, (scores.get(cat) || 0) + 1);
  }
  if (scores.size === 0) return "divers";
  return Array.from(scores.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Mistral Enrichment ────────────────────────────────────────────

function getMistral() {
  return new Mistral({ apiKey: process.env.MISTRAL_API_KEY || "" });
}

/**
 * Enrich a batch of datasets with a single Mistral call.
 * Uses sequential indices (1, 2, 3...) instead of UUIDs for reliable mapping.
 * Returns a Map of dataset ID → enrichment data.
 */
async function enrichBatchMistral(
  datasets: StoredDataset[]
): Promise<Map<string, StoredEnrichment>> {
  const result = new Map<string, StoredEnrichment>();
  if (datasets.length === 0) return result;

  // Use numbered indices — Mistral copies small numbers accurately, not long UUIDs
  const dsLines = datasets
    .map((ds, i) => {
      const tags = ds.tags.slice(0, 6).join(", ");
      const desc = ds.desc ? ds.desc.substring(0, 150) : "";
      return `${i + 1}. "${ds.title}" | ${ds.org} | [${tags}]${desc ? " | " + desc : ""}`;
    })
    .join("\n");

  // Build subcategory hints from SUBCATEGORIES for consistency guidance
  const subHints = CATEGORY_SLUGS
    .map((slug) => {
      const subs = SUBCATEGORIES[slug];
      if (!subs || subs.length === 0) return null;
      return `${slug}: ${subs.map((s) => s.slug).join(", ")}`;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `Tu es un expert en donnees ouvertes francaises. Categorise ces ${datasets.length} items de data.gouv.fr.

Categories possibles: ${CATEGORY_SLUGS.join(", ")}

Sous-categories suggerees (tu peux en proposer d'autres si necessaire, mais sois COHERENT dans les noms):
${subHints}

Niveaux geographiques:
- national: couvre toute la France
- regional: region (Ile-de-France, Bretagne, PACA, etc.)
- departemental: departement (Paris, Bouches-du-Rhone, etc.)
- communal: ville (Paris, Lyon, Marseille, etc.)

Items:
${dsLines}

Pour CHAQUE item, retourne un objet avec:
- n: numero de l'item (1, 2, 3...)
- cat: slug categorie
- sub: sous-categorie (2-5 mots, ex: "Qualite de l'air")
- sub2: sous-sous-categorie plus precise (2-4 mots, ex: "Emissions industrielles")
- geo: national/regional/departemental/communal
- area: zone geographique precise ou null
- sum: resume 1 phrase
- th: [3-5 mots-cles]
- q: qualite 1-5

IMPORTANT: Utilise des noms IDENTIQUES pour les memes concepts (ex: toujours "Qualite de l'air", jamais "Qualite air" ou "Air ambiant").

JSON: {"r":[{"n":1,"cat":"...","sub":"...","sub2":"...","geo":"...","area":null,"sum":"...","th":["..."],"q":3}]}`;

  try {
    const mistral = getMistral();
    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: datasets.length * 220 + 100,
      responseFormat: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return result;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const fixed = content.replace(/,\s*([}\]])/g, "$1");
      parsed = JSON.parse(fixed);
    }

    // Accept both "r" (compact) and "results" (verbose) keys
    const items = parsed.r || parsed.results || parsed;
    if (!Array.isArray(items)) return result;

    const validCats = new Set(TAXONOMY.map((c) => c.slug));
    const validGeo = new Set(["national", "regional", "departemental", "communal"]);
    const now = new Date().toISOString();

    for (const item of items) {
      // Map by index number (1-based) → dataset ID
      const idx = (typeof item.n === "number" ? item.n : parseInt(item.n, 10)) - 1;
      if (isNaN(idx) || idx < 0 || idx >= datasets.length) continue;

      const dsId = datasets[idx].id;
      result.set(dsId, {
        cat: validCats.has(item.cat) ? item.cat : "divers",
        sub: String(item.sub || "General").substring(0, 80),
        sub2: item.sub2 ? String(item.sub2).substring(0, 80) : undefined,
        geo: validGeo.has(item.geo) ? item.geo : "national",
        area: item.area && item.area !== "null" ? String(item.area).substring(0, 60) : undefined,
        sum: String(item.sum || "").substring(0, 250),
        th: Array.isArray(item.th) ? item.th.slice(0, 5).map(String) : [],
        q: typeof item.q === "number" ? Math.min(5, Math.max(1, Math.round(item.q))) : 3,
        at: now,
      });
    }
  } catch (err) {
    // Clean error message (strip HTML from 502/503 responses)
    let errMsg = err instanceof Error ? err.message : String(err);
    const statusMatch = errMsg.match(/Status (\d{3})/);
    if (statusMatch && errMsg.includes("<html")) {
      errMsg = `Mistral API ${statusMatch[1]} (serveur temporairement indisponible)`;
    }
    logWarn(`Mistral batch: ${errMsg}`);
  }

  return result;
}

/**
 * Enrich unprocessed datasets in the store.
 * Prioritizes popular datasets (most views + downloads).
 * Processes in batches of ENRICHMENT_BATCH_SIZE with ENRICHMENT_CONCURRENCY concurrent calls.
 */
async function enrichDatasets(store: Store, maxCount: number): Promise<number> {
  const unenriched = Object.values(store.ds)
    .filter((ds) => !ds.e && (!ds.ef || ds.ef < 3))
    .sort((a, b) => (b.v + b.dl * 2) - (a.v + a.dl * 2))
    .slice(0, maxCount);

  if (unenriched.length === 0) {
    const total = Object.keys(store.ds).length;
    const enrichedTotal = Object.values(store.ds).filter((d) => d.e).length;
    logSuccess(`Tous les items enrichis (${formatNumber(enrichedTotal)}/${formatNumber(total)})`);
    return 0;
  }

  const totalToProcess = unenriched.length;
  const totalBatches = Math.ceil(totalToProcess / (ENRICHMENT_BATCH_SIZE * ENRICHMENT_CONCURRENCY));

  logSection("🧠", `Enrichissement Mistral — ${formatNumber(totalToProcess)} items`);
  logStep("⚙️", `${DIM}batch=${ENRICHMENT_BATCH_SIZE} · concurrency=${ENRICHMENT_CONCURRENCY} · model=${MISTRAL_MODEL}${RESET}`);
  logStep("📊", `${DIM}${totalBatches} mega-batches · ${Math.ceil(totalToProcess / ENRICHMENT_BATCH_SIZE)} appels Mistral · checkpoint/${SAVE_CHECKPOINT_EVERY}${RESET}`);

  const stats: EnrichmentStats = {
    enriched: 0,
    failed: 0,
    retried: 0,
    retrySuccess: 0,
    total: totalToProcess,
    startTime: Date.now(),
  };

  const megaBatchSize = ENRICHMENT_BATCH_SIZE * ENRICHMENT_CONCURRENCY;
  let batchNum = 0;

  for (let i = 0; i < unenriched.length; i += megaBatchSize) {
    batchNum++;
    const megaBatch = unenriched.slice(i, i + megaBatchSize);

    // Split into concurrent sub-batches
    const subBatches: StoredDataset[][] = [];
    for (let j = 0; j < megaBatch.length; j += ENRICHMENT_BATCH_SIZE) {
      subBatches.push(megaBatch.slice(j, j + ENRICHMENT_BATCH_SIZE));
    }

    // Run concurrent Mistral calls
    const results = await Promise.allSettled(
      subBatches.map((batch) => enrichBatchMistral(batch))
    );

    // Collect items that need retry
    const retryItems: StoredDataset[] = [];

    for (let k = 0; k < results.length; k++) {
      const subBatch = subBatches[k];
      const res = results[k];

      if (res.status === "fulfilled") {
        const enrichments = res.value;
        for (const ds of subBatch) {
          const enrichment = enrichments.get(ds.id);
          if (enrichment) {
            store.ds[ds.id].e = enrichment;
            stats.enriched++;
          } else {
            retryItems.push(ds);
          }
        }
      } else {
        retryItems.push(...subBatch);
        const errMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
        if (errMsg.includes("429") || errMsg.includes("rate")) {
          logWarn(`Rate-limit Mistral — pause 5s puis retry`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    // Retry failed items
    if (retryItems.length > 0) {
      stats.retried += retryItems.length;
      await new Promise((r) => setTimeout(r, ENRICHMENT_RETRY_DELAY_MS));

      const retryGroups: StoredDataset[][] = [];
      for (let r = 0; r < retryItems.length; r += ENRICHMENT_BATCH_SIZE) {
        retryGroups.push(retryItems.slice(r, r + ENRICHMENT_BATCH_SIZE));
      }

      for (const retryBatch of retryGroups) {
        try {
          const retryResult = await enrichBatchMistral(retryBatch);
          for (const ds of retryBatch) {
            const enrichment = retryResult.get(ds.id);
            if (enrichment) {
              store.ds[ds.id].e = enrichment;
              stats.enriched++;
              stats.retrySuccess++;
            } else {
              store.ds[ds.id].ef = (store.ds[ds.id].ef || 0) + 1;
              stats.failed++;
            }
          }
        } catch {
          for (const ds of retryBatch) {
            store.ds[ds.id].ef = (store.ds[ds.id].ef || 0) + 1;
            stats.failed++;
          }
        }
        await new Promise((r) => setTimeout(r, ENRICHMENT_DELAY_MS));
      }
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, ENRICHMENT_DELAY_MS));

    // Progress log every 5 batches or at the end
    if (batchNum % 5 === 0 || i + megaBatchSize >= unenriched.length) {
      logEnrichmentProgress(stats, batchNum, totalBatches);
    }

    // Periodic checkpoint
    if (stats.enriched > 0 && stats.enriched % SAVE_CHECKPOINT_EVERY < megaBatchSize) {
      const storeSizeMB = (Buffer.byteLength(JSON.stringify(store)) / 1_000_000).toFixed(1);
      await saveStore(store);
      logStep("💾", `${BG_CYAN} CHECKPOINT ${RESET} ${formatNumber(stats.enriched)} enrichis sauvegardés ${DIM}(store: ${storeSizeMB} MB)${RESET}`);
    }
  }

  // Final enrichment summary
  const elapsed = Date.now() - stats.startTime;
  const speed = elapsed > 0 ? (stats.enriched / (elapsed / 1000)) : 0;

  logSection("📋", "Bilan enrichissement");
  logStep("✅", `${GREEN}${BOLD}${formatNumber(stats.enriched)}${RESET}${GREEN} enrichis avec succes${RESET}`);
  if (stats.failed > 0) logStep("❌", `${RED}${stats.failed} echecs definitifs${RESET}`);
  if (stats.retried > 0) logStep("🔄", `${YELLOW}${stats.retried} retries (${stats.retrySuccess} recuperes)${RESET}`);
  logStep("⚡", `${CYAN}${speed.toFixed(1)} items/s en moyenne${RESET}`);
  logStep("⏱️", `${BLUE}${formatDuration(elapsed)} total${RESET}`);

  return stats.enriched;
}

// ── Catalog Building ──────────────────────────────────────────────

function toCatalogItem(sd: StoredDataset): CatalogItem {
  const item: CatalogItem = {
    id: sd.id,
    title: sd.title,
    organization: sd.org,
    type: sd.type === "d" ? "dataset" : "dataservice",
    tags: sd.tags,
  };

  // Metrics (only include non-zero to save space)
  if (sd.v) item.views = sd.v;
  if (sd.dl) item.downloads = sd.dl;
  if (sd.r) item.reuses = sd.r;
  if (sd.f) item.followers = sd.f;
  if (sd.lic) item.license = sd.lic;
  if (sd.freq) item.frequency = sd.freq;
  if (sd.mod) item.lastModified = sd.mod;
  if (sd.url) item.baseApiUrl = sd.url;

  // Enrichment fields
  if (sd.e) {
    if (sd.e.sum) item.summary = sd.e.sum;
    item.geo = sd.e.geo;
    if (sd.e.area) item.geoArea = sd.e.area;
    if (sd.e.th.length > 0) item.themes = sd.e.th;
    item.quality = sd.e.q;
    // sub2 is set during buildCatalog after taxonomy mapping
  }

  return item;
}

function normalizeSlug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);
}

function buildCatalog(store: Store, taxonomy: TaxonomyMapping | null): Catalog {
  const allItems = Object.values(store.ds);
  const datasets = allItems.filter((d) => d.type === "d");
  const apis = allItems.filter((d) => d.type === "a");
  const enrichedItems = allItems.filter((d) => d.e);

  // ── Group by category ──
  const catGroups = new Map<string, StoredDataset[]>();
  for (const cat of TAXONOMY) {
    catGroups.set(cat.slug, []);
  }

  for (const item of allItems) {
    const cat = item.e?.cat || assignCategoryByTags(item.tags);
    if (catGroups.has(cat)) {
      catGroups.get(cat)!.push(item);
    } else {
      catGroups.get("divers")!.push(item);
    }
  }

  // ── Build categories ──
  const categories: CatalogCategory[] = TAXONOMY
    .map((taxCat, i) => {
      const items = catGroups.get(taxCat.slug) || [];
      if (items.length === 0) return null;

      // Group by subcategory (use taxonomy mapping if available)
      const subGroups = new Map<
        string,
        { label: string; items: StoredDataset[]; sub2Groups: Map<string, { label: string; count: number }> }
      >();

      for (const item of items) {
        const rawSub = item.e?.sub || "Autres";
        const canonical = findCanonicalGroup(taxonomy, taxCat.slug, rawSub);
        const subSlug = canonical.slug;

        if (!subGroups.has(subSlug)) {
          subGroups.set(subSlug, { label: canonical.label, items: [], sub2Groups: new Map() });
        }
        const group = subGroups.get(subSlug)!;
        group.items.push(item);

        // Track sub2 grouping (level 3)
        if (item.e?.sub2) {
          const canonSub2 = findCanonicalSub2(taxonomy, taxCat.slug, subSlug, item.e.sub2);
          if (canonSub2) {
            const existing = group.sub2Groups.get(canonSub2.slug);
            if (existing) {
              existing.count++;
            } else {
              group.sub2Groups.set(canonSub2.slug, { label: canonSub2.label, count: 1 });
            }
          }
        }
      }

      const subcategories: CatalogSubCategory[] = Array.from(subGroups.entries())
        .map(([slug, sg]) => {
          // Build level-3 children from sub2 groups
          const children: CatalogSubSubCategory[] = Array.from(sg.sub2Groups.entries())
            .map(([sub2Slug, data]) => ({
              slug: sub2Slug,
              label: data.label,
              count: data.count,
            }))
            .sort((a, b) => b.count - a.count);

          // Convert items and set sub2 on each
          const catalogItems = sg.items
            .map((sd) => {
              const ci = toCatalogItem(sd);
              if (sd.e?.sub2) {
                const canonSub2 = findCanonicalSub2(taxonomy, taxCat.slug, slug, sd.e.sub2);
                if (canonSub2) {
                  ci.sub2 = canonSub2.slug;
                  ci.sub2Label = canonSub2.label;
                }
              }
              return ci;
            })
            .sort((a, b) => (b.views || 0) - (a.views || 0));

          return {
            slug,
            label: sg.label,
            items: catalogItems,
            children: children.length > 0 ? children : undefined,
          };
        })
        .sort((a, b) => b.items.length - a.items.length);

      return {
        slug: taxCat.slug,
        label: taxCat.label,
        description: taxCat.description,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        subcategories,
        totalItems: items.length,
        totalDatasets: items.filter((it) => it.type === "d").length,
        totalDataservices: items.filter((it) => it.type === "a").length,
      };
    })
    .filter((c): c is CatalogCategory => c !== null)
    .sort((a, b) => b.totalItems - a.totalItems);

  // ── Tags ──
  const tagCounts = new Map<string, number>();
  for (const item of allItems) {
    for (const tag of item.tags) {
      const lower = tag.toLowerCase();
      tagCounts.set(lower, (tagCounts.get(lower) || 0) + 1);
    }
  }
  const tags: CatalogTag[] = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // ── Top datasets ──
  const topDatasets: TopDataset[] = datasets
    .filter((ds) => (ds.v || 0) + (ds.dl || 0) > 0)
    .sort((a, b) => {
      const scoreA = (a.v || 0) + (a.dl || 0) * 2;
      const scoreB = (b.v || 0) + (b.dl || 0) * 2;
      return scoreB - scoreA;
    })
    .slice(0, 30)
    .map((ds) => ({
      id: ds.id,
      title: ds.title,
      organization: ds.org,
      views: ds.v || 0,
      downloads: ds.dl || 0,
      reuses: ds.r || 0,
    }));

  // ── Category stats ──
  const categoryStats: CategoryStats[] = categories.map((cat) => {
    const catItems = cat.subcategories.flatMap((sc) => sc.items);
    return {
      slug: cat.slug,
      label: cat.label,
      color: cat.color,
      totalViews: catItems.reduce((s, it) => s + (it.views || 0), 0),
      totalDownloads: catItems.reduce((s, it) => s + (it.downloads || 0), 0),
      totalReuses: catItems.reduce((s, it) => s + (it.reuses || 0), 0),
      totalItems: cat.totalItems,
    };
  });

  // ── Geographic regions ──
  const geoAreaMap = new Map<string, { scope: string; count: number }>();
  for (const item of enrichedItems) {
    if (item.e?.area) {
      const key = item.e.area;
      const existing = geoAreaMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        geoAreaMap.set(key, { scope: item.e.geo, count: 1 });
      }
    }
  }
  const geoRegions: GeoRegion[] = Array.from(geoAreaMap.entries())
    .map(([label, data]) => ({
      slug: normalizeSlug(label),
      label,
      scope: data.scope,
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Global stats ──
  const globalViews = datasets.reduce((s, ds) => s + (ds.v || 0), 0);
  const globalDownloads = datasets.reduce((s, ds) => s + (ds.dl || 0), 0);
  const globalReuses = datasets.reduce((s, ds) => s + (ds.r || 0), 0);

  return {
    lastSync: new Date().toISOString(),
    categories,
    tags,
    topDatasets,
    categoryStats,
    geoRegions,
    stats: {
      totalDatasets: datasets.length,
      totalDataservices: apis.length,
      totalCategories: categories.length,
      totalTags: tags.length,
      totalViews: globalViews,
      totalDownloads: globalDownloads,
      totalReuses: globalReuses,
      enrichedCount: enrichedItems.length,
      enrichmentProgress:
        allItems.length > 0
          ? Math.round((enrichedItems.length / allItems.length) * 100)
          : 0,
    },
  };
}

// ── Main Sync ─────────────────────────────────────────────────────

export interface SyncOptions {
  skipFetch?: boolean;     // Skip API fetch (only enrich + rebuild)
  maxEnrich?: number;      // Max datasets to enrich this run
  rebuildOnly?: boolean;   // Skip fetch & enrich, just rebuild catalog
  normalize?: boolean;     // Run taxonomy normalization (cluster subcategories)
  normalizeModel?: string; // Model for normalization (default: mistral-large-latest)
  forceNormalize?: boolean; // Force full re-normalization (ignore existing taxonomy)
  reset?: boolean;         // Reset all enrichments (re-enrich from scratch)
}

export async function syncCatalog(options?: SyncOptions): Promise<Catalog> {
  const startTime = Date.now();
  const timestamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

  logHeader(`FlowDataGouv — Sync Catalog · ${timestamp}`);

  const mode = options?.rebuildOnly ? "REBUILD" : options?.skipFetch ? "ENRICH" : "FULL";
  const flags = [
    options?.reset && "RESET",
    options?.normalize && (options?.forceNormalize ? "NORMALIZE(FULL)" : "NORMALIZE"),
    options?.maxEnrich && `MAX=${formatNumber(options.maxEnrich)}`,
  ].filter(Boolean);

  logStep("🚀", `Mode: ${BOLD}${mode}${RESET}${flags.length ? `  ${DIM}[${flags.join(" + ")}]${RESET}` : ""}`);

  if (!process.env.MISTRAL_API_KEY) {
    logError("MISTRAL_API_KEY manquante");
    throw new Error("MISTRAL_API_KEY is required");
  }

  // 1. Load persistent store
  logSection("📦", "Chargement du store");
  const store = await loadStore();
  const prevCount = Object.keys(store.ds).length;
  const prevEnriched = Object.values(store.ds).filter((d) => d.e).length;
  const prevFailed = Object.values(store.ds).filter((d) => d.ef && !d.e).length;
  logStep("📂", `${formatNumber(prevCount)} items en base ${DIM}(${formatNumber(prevEnriched)} enrichis, ${formatNumber(prevFailed)} en echec)${RESET}`);

  // 2. Fetch new datasets from data.gouv.fr (unless skipped)
  if (!options?.skipFetch && !options?.rebuildOnly) {
    logSection("🌐", "Recuperation data.gouv.fr");
    const fetchStart = Date.now();

    const [dsResult, apiResult] = await Promise.all([
      fetchDatasets(store),
      fetchDataservices(store),
    ]);
    store.fetchedAt = new Date().toISOString();

    const totalItems = Object.keys(store.ds).length;
    const newItems = dsResult.added + apiResult.added;
    const fetchDur = formatDuration(Date.now() - fetchStart);

    logSuccess(
      `${formatNumber(totalItems)} items ` +
      `(${GREEN}+${formatNumber(newItems)} nouveaux${RESET}, ` +
      `${DIM}${formatNumber(dsResult.updated + apiResult.updated)} mis a jour${RESET}) ` +
      `en ${fetchDur}`
    );

    await saveStore(store);
  }

  // 2b. Reset enrichments if requested
  if (options?.reset && !options?.rebuildOnly) {
    logSection("🔄", "Reset des enrichissements");
    let resetCount = 0;
    let failResetCount = 0;
    for (const ds of Object.values(store.ds)) {
      if (ds.e) {
        delete ds.e;
        delete ds.ef;
        resetCount++;
      } else if (ds.ef) {
        delete ds.ef;
        failResetCount++;
      }
    }
    if (resetCount > 0 || failResetCount > 0) {
      logStep("🧹", `${formatNumber(resetCount)} enrichissements + ${formatNumber(failResetCount)} echecs ${RED}supprimes${RESET}`);
      logStep("💾", "Sauvegarde du store nettoye...");
      await saveStore(store);
      logSuccess("Store remis a zero — pret pour re-enrichissement");
    } else {
      logStep("✨", `${DIM}Rien a reset (store deja vierge)${RESET}`);
    }
  }

  // 3. Enrich unprocessed datasets with Mistral
  let enrichedThisRun = 0;
  if (!options?.rebuildOnly) {
    const maxEnrich = options?.maxEnrich || MAX_ENRICHMENTS_PER_RUN;
    enrichedThisRun = await enrichDatasets(store, maxEnrich);

    if (enrichedThisRun > 0) {
      logStep("💾", "Sauvegarde finale du store...");
      await saveStore(store);
      logSuccess("Store sauvegarde");
    }
  }

  // 3b. Normalize taxonomy
  let taxonomy = await loadTaxonomy();
  if (options?.normalize) {
    const enrichedCount = Object.values(store.ds).filter((d) => d.e).length;
    if (enrichedCount < 100) {
      logWarn(`Normalisation ignoree : seulement ${formatNumber(enrichedCount)} enrichis (minimum 100)`);
    } else {
      const normModel = options?.normalizeModel || "mistral-large-latest";
      const forceNorm = options?.forceNormalize || false;
      logSection("🏷️", `Normalisation taxonomique ${forceNorm ? "(FULL)" : "(incremental)"} — ${formatNumber(enrichedCount)} items · ${BOLD}${normModel}${RESET}`);
      taxonomy = await normalizeTaxonomy(store, normModel, forceNorm);
      logSuccess("Taxonomie normalisee et sauvegardee");
    }
  }

  // 4. Build catalog
  logSection("🏗️", "Construction du catalog");
  const catalog = buildCatalog(store, taxonomy);
  const catalogJson = JSON.stringify(catalog);
  const catalogSizeMB = (Buffer.byteLength(catalogJson) / 1_000_000).toFixed(1);
  await fs.mkdir(DATA_DIR(), { recursive: true });
  await fs.writeFile(CATALOG_PATH(), catalogJson, "utf-8");

  const storeSizeMB = (Buffer.byteLength(JSON.stringify(store)) / 1_000_000).toFixed(1);
  const totalDuration = Date.now() - startTime;

  // Final report
  const line = "═".repeat(62);
  console.log(`\n${GREEN}╔${line}╗${RESET}`);
  console.log(`${GREEN}║${RESET}  ${BOLD}${GREEN}SYNC TERMINEE${RESET}${" ".repeat(48)}${GREEN}║${RESET}`);
  console.log(`${GREEN}╠${line}╣${RESET}`);
  console.log(`${GREEN}║${RESET}  ⏱️  Duree totale     ${BOLD}${formatDuration(totalDuration).padEnd(39)}${RESET}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  📊 Datasets          ${formatNumber(catalog.stats.totalDatasets).padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  🔌 APIs              ${formatNumber(catalog.stats.totalDataservices).padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  🧠 Enrichis          ${(formatNumber(catalog.stats.enrichedCount) + "/" + formatNumber(Object.keys(store.ds).length) + " (" + catalog.stats.enrichmentProgress + "%)").padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  🆕 Enrichis ce run   ${formatNumber(enrichedThisRun).padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  📁 Categories        ${String(catalog.categories.length).padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  🌍 Regions geo       ${formatNumber(catalog.geoRegions.length).padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  💾 Store             ${(storeSizeMB + " MB").padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}║${RESET}  📄 Catalog           ${(catalogSizeMB + " MB").padEnd(39)}${GREEN}║${RESET}`);
  console.log(`${GREEN}╚${line}╝${RESET}\n`);

  return catalog;
}
