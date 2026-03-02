/**
 * Mistral-powered search result analysis.
 * Groups datasets by theme and provides insights.
 */

import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_MODEL } from "@/lib/constants";

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY || "" });

// Module-level cache (TTL 1h)
interface CachedAnalysis {
  result: SearchAnalysis;
  timestamp: number;
}

const cache = new Map<string, CachedAnalysis>();
const CACHE_TTL = 3600_000;

export interface DatasetSummary {
  id: string;
  title: string;
  organization?: string;
  tags: string[];
  category?: string;
  geoScope?: string;
}

export interface AnalysisGroup {
  label: string;
  description: string;
  datasetIds: string[];
}

export interface SearchAnalysis {
  summary: string;
  groups: AnalysisGroup[];
  insights: string[];
}

const SYSTEM_PROMPT = `Tu es un analyste de donnees ouvertes francaises. L'utilisateur recherche des datasets sur data.gouv.fr.

Tu recois une requete de recherche et une liste de datasets trouves. Tu dois:

1. Ecrire un resume court (2-3 phrases) de ce que couvrent les resultats
2. Regrouper les datasets en 3-6 categories thematiques pertinentes
3. Pour chaque categorie: un label court (2-4 mots), une description (1 phrase), et les IDs des datasets correspondants
4. Donner 2-3 observations cles sur les donnees disponibles

IMPORTANT:
- Chaque dataset doit apparaitre dans exactement une categorie
- Les labels doivent etre courts et informatifs
- Les IDs doivent correspondre EXACTEMENT a ceux fournis (copier-coller)
- Reponds UNIQUEMENT en JSON valide (pas de texte avant ou apres)

Format JSON:
{"summary": "...", "groups": [{"label": "...", "description": "...", "datasetIds": ["id1", "id2"]}], "insights": ["...", "..."]}`;

export async function analyzeSearchResults(
  query: string,
  datasets: DatasetSummary[]
): Promise<SearchAnalysis> {
  if (datasets.length < 3) {
    return { summary: "", groups: [], insights: [] };
  }

  const cacheKey = `${query.toLowerCase().trim()}|${datasets.length}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  if (!process.env.MISTRAL_API_KEY) {
    return { summary: "", groups: [], insights: [] };
  }

  const datasetLines = datasets
    .slice(0, 50)
    .map(
      (ds) =>
        `${ds.id} | ${ds.title} | ${ds.organization || "-"} | ${ds.tags.slice(0, 3).join(", ")}${ds.category ? ` | ${ds.category}` : ""}${ds.geoScope ? ` | ${ds.geoScope}` : ""}`
    )
    .join("\n");

  const userMessage = `Requete: "${query}"
${datasets.length} datasets trouves.

Datasets (ID | Titre | Organisation | Tags | Theme | Territoire):
${datasetLines}`;

  try {
    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      maxTokens: 1500,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return { summary: "", groups: [], insights: [] };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { summary: "", groups: [], insights: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate IDs against actual dataset list
    const validIds = new Set(datasets.map((d) => d.id));

    const result: SearchAnalysis = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      groups: Array.isArray(parsed.groups)
        ? parsed.groups
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (g: any) =>
                g.label && g.description && Array.isArray(g.datasetIds)
            )
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((g: any) => ({
              label: String(g.label),
              description: String(g.description),
              datasetIds: g.datasetIds.filter((id: string) =>
                validIds.has(id)
              ),
            }))
            .filter((g: AnalysisGroup) => g.datasetIds.length > 0)
        : [],
      insights: Array.isArray(parsed.insights)
        ? parsed.insights
            .filter((i: unknown) => typeof i === "string")
            .slice(0, 5)
        : [],
    };

    cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.error("[search/analyze] Mistral error:", err);
    return { summary: "", groups: [], insights: [] };
  }
}
