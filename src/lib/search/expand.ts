/**
 * Mistral-powered search query expansion.
 * Corrects typos and generates keyword variations for better search results.
 */

import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_MODEL } from "@/lib/constants";

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY || "" });

// Module-level cache (TTL 1h)
interface CachedExpansion {
  result: SearchExpansion;
  timestamp: number;
}

const cache = new Map<string, CachedExpansion>();
const CACHE_TTL = 3600_000; // 1 hour

export interface SuggestedFilters {
  categories?: string[];
  geoScopes?: string[];
  geoAreas?: string[];
}

export interface SearchExpansion {
  original: string;
  corrected: string;
  keywords: string[];
  suggestedFilters?: SuggestedFilters;
  wasExpanded: boolean;
}

const CATEGORY_SLUGS = [
  "environnement", "transport-mobilite", "sante", "education-recherche",
  "economie-emploi", "logement-urbanisme", "agriculture-alimentation",
  "culture-patrimoine", "justice-securite", "collectivites-administration",
  "finances-fiscalite", "geographie-cartographie", "energie",
  "social-solidarite", "tourisme-loisirs-sport", "numerique-technologie",
  "elections-democratie", "divers",
];

const GEO_SCOPES = ["national", "regional", "departemental", "communal"];

const SYSTEM_PROMPT = `Tu es un assistant specialise dans la reecriture de requetes de recherche pour un portail de 73 000+ datasets/APIs ouvertes francaises (data.gouv.fr).

L'utilisateur te donne une requete brute. Tu dois:
1. Corriger les fautes d'orthographe si necessaire
2. Generer 3 a 5 mots-cles courts et pertinents pour la recherche plein-texte
3. Detecter si la requete implique une categorie ou un niveau geographique specifique

CATEGORIES DISPONIBLES:
environnement, transport-mobilite, sante, education-recherche, economie-emploi,
logement-urbanisme, agriculture-alimentation, culture-patrimoine, justice-securite,
collectivites-administration, finances-fiscalite, geographie-cartographie, energie,
social-solidarite, tourisme-loisirs-sport, numerique-technologie, elections-democratie

NIVEAUX GEOGRAPHIQUES: national, regional, departemental, communal

REGLES:
- Mots-cles: courts (1-3 mots), termes techniques/administratifs francais SPECIFIQUES
- PAS de mots generiques: "donnees", "fichier", "dataset", "csv", "open data", "ville", "commune", "region", "departement", "pays", "territoire", "france", "information"
- Inclus toujours la version corrigee comme premier mot-cle
- NE PAS inclure les noms de lieux dans les keywords si tu les mets dans suggestedGeoAreas
- suggestedCategories: uniquement si la requete mentionne clairement un theme (max 2)
- suggestedGeoScopes: le niveau geo si un lieu est mentionne
  Ex: "Paris" → communal, "Bretagne" → regional, "Yonne" → departemental, "France" → national
- suggestedGeoAreas: le NOM EXACT du lieu mentionne (region, departement, commune)
  Ex: "données sur l'Yonne" → ["Yonne"], "transport Dijon" → ["Dijon"], "Île-de-France" → ["Île-de-France"]
  IMPORTANT: Utiliser le nom officiel (Île-de-France, pas ile de france)

Reponds UNIQUEMENT au format JSON (pas de texte avant ou apres):
{"corrected": "requete corrigee", "keywords": ["kw1", "kw2", "kw3"], "suggestedCategories": [], "suggestedGeoScopes": [], "suggestedGeoAreas": []}`;

export async function expandSearchQuery(query: string): Promise<SearchExpansion> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { original: query, corrected: query, keywords: [query], wasExpanded: false };
  }

  // Check cache
  const cacheKey = trimmed.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[mistral] cache hit "${trimmed}"`);
    return cached.result;
  }

  // No API key = no expansion
  if (!process.env.MISTRAL_API_KEY) {
    return { original: trimmed, corrected: trimmed, keywords: [trimmed], wasExpanded: false };
  }

  try {
    const t0 = Date.now();
    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
      temperature: 0.3,
      maxTokens: 200,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return fallback(trimmed);
    }

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallback(trimmed);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const corrected = typeof parsed.corrected === "string" ? parsed.corrected.trim() : trimmed;
    const keywords: string[] = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k: unknown) => typeof k === "string" && k.trim()).map((k: string) => k.trim())
      : [corrected];

    // Ensure corrected query is always first
    if (!keywords.includes(corrected)) {
      keywords.unshift(corrected);
    }

    // Extract suggested filters (validate against known values)
    const suggestedFilters: SuggestedFilters = {};
    if (Array.isArray(parsed.suggestedCategories)) {
      const validCats = parsed.suggestedCategories
        .filter((c: unknown) => typeof c === "string" && CATEGORY_SLUGS.includes(c as string));
      if (validCats.length > 0) suggestedFilters.categories = validCats;
    }
    if (Array.isArray(parsed.suggestedGeoScopes)) {
      const validGeos = parsed.suggestedGeoScopes
        .filter((g: unknown) => typeof g === "string" && GEO_SCOPES.includes(g as string));
      if (validGeos.length > 0) suggestedFilters.geoScopes = validGeos;
    }
    if (Array.isArray(parsed.suggestedGeoAreas)) {
      const areas = parsed.suggestedGeoAreas
        .filter((a: unknown) => typeof a === "string" && (a as string).trim().length > 0)
        .map((a: string) => a.trim());
      if (areas.length > 0) suggestedFilters.geoAreas = areas;
    }

    // Cap at 5 keywords
    const result: SearchExpansion = {
      original: trimmed,
      corrected,
      keywords: keywords.slice(0, 5),
      ...(Object.keys(suggestedFilters).length > 0 ? { suggestedFilters } : {}),
      wasExpanded: true,
    };

    const ms = Date.now() - t0;
    console.log(
      `[mistral] "${trimmed}"${corrected !== trimmed ? ` → "${corrected}"` : ""} keywords=[${result.keywords.join(", ")}] (${ms}ms)`
    );

    cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.error("[search/expand] Mistral error:", err);
    return fallback(trimmed);
  }
}

function fallback(query: string): SearchExpansion {
  return {
    original: query,
    corrected: query,
    keywords: [query],
    wasExpanded: false,
  };
}
