/**
 * Mistral-powered re-ranking of search results.
 * Takes the top N algorithmically-scored results and re-orders them
 * by semantic relevance using Mistral Small.
 */

import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_MODEL } from "@/lib/constants";

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY || "" });

// Module-level cache (TTL 1h)
interface CachedRerank {
  rerankedIds: string[];
  timestamp: number;
}

const cache = new Map<string, CachedRerank>();
const CACHE_TTL = 3600_000; // 1 hour
const RERANK_TIMEOUT_MS = 1500;

export interface RerankCandidate {
  id: string;
  title: string;
  organization: string;
  summary: string;
  quality: number;
  views: number;
  downloads: number;
}

export interface RerankResult {
  rerankedIds: string[];
  wasReranked: boolean;
}

const SYSTEM_PROMPT = `Tu es un expert en donnees ouvertes francaises (data.gouv.fr). On te donne une requete utilisateur et des resultats de recherche numerotes. Reordonne-les du plus pertinent au moins pertinent.

REGLES:
- Considere l'intention de l'utilisateur: que cherche-t-il concretement?
- Les datasets nationaux/officiels de reference sont generalement plus pertinents que les extractions locales/regionales du meme dataset
- Un dataset avec beaucoup de vues et une bonne qualite est souvent un bon indicateur de reference
- Privilegie les sources primaires (producteur original) plutot que les copies/extractions
- Reponds UNIQUEMENT avec un tableau JSON des numeros dans l'ordre de pertinence decroissante
- Format: [3,1,7,2,...]
- Tu DOIS inclure TOUS les numeros fournis, sans en ajouter ni en retirer`;

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function buildUserMessage(query: string, items: RerankCandidate[]): string {
  const lines = items.map((item, i) => {
    const title = item.title.slice(0, 80);
    const org = item.organization.slice(0, 40);
    const summary = item.summary.slice(0, 100);
    const views = formatViews(item.views + item.downloads);
    return `${i + 1}. ${title} | ${org} | ${summary} | q=${item.quality} v=${views}`;
  });
  return `Requete: "${query}"\n\n${lines.join("\n")}`;
}

function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

export function isRerankCached(query: string): boolean {
  const cached = cache.get(cacheKey(query));
  return !!(cached && Date.now() - cached.timestamp < CACHE_TTL);
}

export async function rerankResults(
  query: string,
  corrected: string,
  items: RerankCandidate[],
): Promise<RerankResult> {
  if (items.length < 3) {
    return { rerankedIds: items.map((i) => i.id), wasReranked: false };
  }

  // Check cache
  const key = cacheKey(corrected || query);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Verify cached IDs match current items (store.json may have changed)
    const currentIds = new Set(items.map((i) => i.id));
    if (cached.rerankedIds.every((id) => currentIds.has(id))) {
      return { rerankedIds: cached.rerankedIds, wasReranked: true };
    }
  }

  if (!process.env.MISTRAL_API_KEY) {
    return { rerankedIds: items.map((i) => i.id), wasReranked: false };
  }

  try {
    const t0 = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(corrected || query, items) },
      ],
      temperature: 0,
      maxTokens: 300,
    });

    clearTimeout(timeout);

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return fallback(items, "empty response");
    }

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return fallback(items, "no JSON array found");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return fallback(items, "parsed value is not array");
    }

    // Convert 1-indexed numbers to 0-indexed, validate
    const indices = parsed.map((n: unknown) => {
      const num = typeof n === "number" ? n : parseInt(String(n), 10);
      return num - 1; // 1-indexed → 0-indexed
    });

    // Validate: all indices must be valid and unique
    const validIndices = new Set<number>();
    for (const idx of indices) {
      if (typeof idx !== "number" || isNaN(idx) || idx < 0 || idx >= items.length) {
        return fallback(items, `invalid index: ${idx + 1}`);
      }
      validIndices.add(idx);
    }

    // Must have at least 80% of items (tolerate minor omissions)
    if (validIndices.size < items.length * 0.8) {
      return fallback(items, `only ${validIndices.size}/${items.length} indices`);
    }

    // Build reranked list: Mistral-ordered first, then any missing items in original order
    const rerankedIds: string[] = [];
    const seen = new Set<number>();
    for (const idx of indices) {
      if (!seen.has(idx)) {
        seen.add(idx);
        rerankedIds.push(items[idx].id);
      }
    }
    // Append any items Mistral forgot, in their original order
    for (let i = 0; i < items.length; i++) {
      if (!seen.has(i)) {
        rerankedIds.push(items[i].id);
      }
    }

    const ms = Date.now() - t0;
    console.error(
      `[search/rerank] "${query}" → reranked ${items.length} items (${ms}ms)`
    );

    // Cache result
    cache.set(key, { rerankedIds, timestamp: Date.now() });

    return { rerankedIds, wasReranked: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fallback(items, msg);
  }
}

function fallback(items: RerankCandidate[], reason: string): RerankResult {
  console.error(`[search/rerank] fallback: ${reason}`);
  return { rerankedIds: items.map((i) => i.id), wasReranked: false };
}
