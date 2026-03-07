/**
 * Sync store.json → MeiliSearch index.
 * Called at server startup and when store.json changes.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  isHealthy,
  configureIndex,
  indexDocuments,
  getDocumentCount,
  CATEGORY_LABELS,
  type MeiliDocument,
} from "./meili-client";

// ── Store types (compact keys, same as search-engine.ts) ─────────

interface StoredEnrichment {
  cat: string;
  sub: string;
  sub2?: string;
  geo: string;
  area?: string;
  sum: string;
  th: string[];
  q: number;
  at: string;
}

interface StoredDataset {
  id: string;
  title: string;
  org: string;
  type: "d" | "a";
  tags: string[];
  v: number;
  dl: number;
  r: number;
  f: number;
  lic?: string;
  freq?: string;
  mod?: string;
  url?: string;
  desc?: string;
  e?: StoredEnrichment;
  ef?: number;
}

interface Store {
  v: number;
  fetchedAt?: string;
  ds: Record<string, StoredDataset>;
}

// ── State ────────────────────────────────────────────────────────

const STORE_PATH = () => path.join(process.cwd(), "data", "store.json");
let lastMtime = 0;
let syncing: Promise<void> | null = null;

// ── Transform ────────────────────────────────────────────────────

function storeToMeiliDocs(store: Store): MeiliDocument[] {
  const docs: MeiliDocument[] = [];

  for (const ds of Object.values(store.ds)) {
    const e = ds.e;
    const cat = e?.cat || "";
    docs.push({
      id: ds.id,
      title: ds.title,
      org: ds.org,
      type: ds.type === "a" ? "dataservice" : "dataset",
      tags: ds.tags || [],
      views: ds.v || 0,
      downloads: ds.dl || 0,
      reuses: ds.r || 0,
      lastModified: ds.mod || "",
      license: ds.lic || "notspecified",
      frequency: ds.freq || "",
      category: cat,
      categoryLabel: CATEGORY_LABELS[cat] || cat,
      subcategory: e?.sub || "",
      sub2: e?.sub2 || "",
      geoScope: e?.geo || "",
      geoArea: e?.area || "",
      summary: e?.sum || "",
      themes: e?.th || [],
      quality: e?.q || 0,
      description: ds.desc || "",
      hasHvd: (ds.tags || []).includes("hvd"),
      _popularity: Math.log10(1 + (ds.v || 0) + (ds.dl || 0)),
    });
  }

  return docs;
}

// ── Sync ─────────────────────────────────────────────────────────

/**
 * Sync store.json to MeiliSearch.
 * - On first call: configure index + full index
 * - On subsequent calls: re-index only if store.json changed (mtime)
 */
export async function syncToMeili(): Promise<{ synced: boolean; count: number }> {
  // Prevent concurrent syncs
  if (syncing) {
    await syncing;
    return { synced: false, count: await getDocumentCount() };
  }

  let resolve: () => void;
  syncing = new Promise<void>((r) => { resolve = r; });

  try {
    // Check health
    const healthy = await isHealthy();
    if (!healthy) {
      console.warn("[meili-sync] MeiliSearch not reachable, skipping sync");
      return { synced: false, count: 0 };
    }

    // Check store.json
    const storePath = STORE_PATH();
    let stat;
    try {
      stat = await fs.stat(storePath);
    } catch {
      console.warn("[meili-sync] store.json not found");
      return { synced: false, count: 0 };
    }

    // Skip if already synced and store hasn't changed
    const currentCount = await getDocumentCount();
    if (lastMtime === stat.mtimeMs && currentCount > 0) {
      return { synced: false, count: currentCount };
    }

    console.log("[meili-sync] Loading store.json...");
    const raw = await fs.readFile(storePath, "utf-8");
    const store: Store = JSON.parse(raw);

    // Configure index (idempotent)
    await configureIndex();

    // Transform and index
    const docs = storeToMeiliDocs(store);
    console.log(`[meili-sync] Indexing ${docs.length} documents...`);
    await indexDocuments(docs);

    lastMtime = stat.mtimeMs;
    const finalCount = await getDocumentCount();
    console.log(`[meili-sync] Done. ${finalCount} documents indexed.`);
    return { synced: true, count: finalCount };
  } catch (err) {
    console.error("[meili-sync] Error:", err);
    return { synced: false, count: 0 };
  } finally {
    resolve!();
    syncing = null;
  }
}

/**
 * Check if store.json has changed and re-sync if needed.
 * Lightweight — only stats the file.
 */
export async function ensureFresh(): Promise<void> {
  try {
    const stat = await fs.stat(STORE_PATH());
    if (stat.mtimeMs !== lastMtime) {
      await syncToMeili();
    }
  } catch {
    // store.json missing, nothing to do
  }
}
