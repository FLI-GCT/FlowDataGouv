/**
 * Disk-based LRU download cache for dataset resources.
 *
 * Files are stored in data/download-cache/{resourceId} with metadata
 * in _index.json. Eviction is by last-access time (not download date).
 *
 * Config: DOWNLOAD_CACHE_MAX_GB env var (default 10).
 * Safe for PM2 cluster: index read from disk each time, writes via atomic rename.
 */

import * as fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

// ── Types ────────────────────────────────────────────────────────

export interface CacheEntry {
  resourceId: string;
  filename: string;
  contentType: string;
  size: number;
  lastAccessed: number;
  cachedAt: number;
  originalUrl: string;
}

interface CacheIndex {
  version: 1;
  totalSize: number;
  entries: Record<string, CacheEntry>;
}

// ── Config ───────────────────────────────────────────────────────

const CACHE_DIR = () => path.join(process.cwd(), "data", "download-cache");
const INDEX_PATH = () => path.join(CACHE_DIR(), "_index.json");
const MAX_CACHE_BYTES = () =>
  parseFloat(process.env.DOWNLOAD_CACHE_MAX_GB || "10") * 1024 * 1024 * 1024;

// In-progress downloads (prevents double-fetch within same process)
const inProgress = new Map<string, Promise<{ filePath: string; entry: CacheEntry }>>();

// ── Index I/O (disk-based, no stale in-memory copy) ─────────────

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR(), { recursive: true });
}

async function loadIndex(): Promise<CacheIndex> {
  try {
    const raw = await fs.readFile(INDEX_PATH(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, totalSize: 0, entries: {} };
  }
}

async function saveIndex(index: CacheIndex): Promise<void> {
  const tmpPath = INDEX_PATH() + `.tmp.${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(index));
  await fs.rename(tmpPath, INDEX_PATH());
}

function entryFilePath(resourceId: string): string {
  return path.join(CACHE_DIR(), resourceId);
}

// ── Filename extraction ─────────────────────────────────────────

function extractFilename(disposition: string | null, url: string): string {
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    if (match) return decodeURIComponent(match[1].replace(/"/g, ""));
  }
  try {
    const pathname = new URL(url).pathname;
    const basename = pathname.split("/").pop();
    if (basename && basename.includes(".")) return basename.split("?")[0];
  } catch { /* ignore */ }
  return "download";
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Check if a resource is cached. If yes, update lastAccessed and return path.
 */
export async function getCachedPath(resourceId: string): Promise<{
  filePath: string;
  entry: CacheEntry;
} | null> {
  const index = await loadIndex();
  const entry = index.entries[resourceId];
  if (!entry) return null;

  const fp = entryFilePath(resourceId);
  try {
    await fs.access(fp);
  } catch {
    // File missing on disk — remove stale entry
    delete index.entries[resourceId];
    index.totalSize = Object.values(index.entries).reduce((s, e) => s + e.size, 0);
    await saveIndex(index).catch(() => {});
    return null;
  }

  // Update last accessed time
  entry.lastAccessed = Date.now();
  await saveIndex(index).catch(() => {});

  return { filePath: fp, entry };
}

/**
 * Download a resource and cache it. Returns path + entry.
 * Handles concurrent requests for the same resource (only one fetch).
 */
export async function cacheResource(
  resourceId: string,
  resourceUrl: string,
): Promise<{ filePath: string; entry: CacheEntry }> {
  // Deduplicate concurrent requests within same process
  const existing = inProgress.get(resourceId);
  if (existing) return existing;

  const promise = doDownload(resourceId, resourceUrl);
  inProgress.set(resourceId, promise);

  try {
    return await promise;
  } finally {
    inProgress.delete(resourceId);
  }
}

async function doDownload(
  resourceId: string,
  resourceUrl: string,
): Promise<{ filePath: string; entry: CacheEntry }> {
  await ensureCacheDir();

  const tempPath = path.join(CACHE_DIR(), `_tmp_${resourceId}_${Date.now()}`);
  const finalPath = entryFilePath(resourceId);

  try {
    const response = await fetch(resourceUrl, {
      signal: AbortSignal.timeout(600_000), // 10 min
      headers: { "User-Agent": "FlowDataGouv/1.0" },
      redirect: "follow",
    });

    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    if (!response.body) throw new Error("No response body");

    // Stream to temp file (memory-efficient)
    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
    const fileStream = createWriteStream(tempPath);
    await pipeline(nodeStream, fileStream);

    // Get size & atomic rename
    const stat = await fs.stat(tempPath);
    await fs.rename(tempPath, finalPath);

    // Build entry
    const disposition = response.headers.get("content-disposition");
    const filename = extractFilename(disposition, resourceUrl);
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    const entry: CacheEntry = {
      resourceId,
      filename,
      contentType,
      size: stat.size,
      lastAccessed: Date.now(),
      cachedAt: Date.now(),
      originalUrl: resourceUrl,
    };

    // Update index
    const index = await loadIndex();
    // If replacing an existing entry, subtract old size
    if (index.entries[resourceId]) {
      index.totalSize -= index.entries[resourceId].size;
    }
    index.entries[resourceId] = entry;
    index.totalSize += entry.size;
    await saveIndex(index);

    // Evict if over limit (async, don't block response)
    if (index.totalSize > MAX_CACHE_BYTES()) {
      evictLRU().catch((err) => console.error("[download-cache] evict error:", err));
    }

    return { filePath: finalPath, entry };
  } catch (err) {
    // Clean up temp file on failure
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Evict least-recently-used entries until total size is under the limit.
 */
export async function evictLRU(): Promise<void> {
  const index = await loadIndex();
  const maxBytes = MAX_CACHE_BYTES();

  if (index.totalSize <= maxBytes) return;

  // Sort by lastAccessed ascending (oldest first)
  const sorted = Object.values(index.entries).sort(
    (a, b) => a.lastAccessed - b.lastAccessed,
  );

  let freed = 0;
  const toDelete: string[] = [];

  for (const entry of sorted) {
    if (index.totalSize - freed <= maxBytes) break;
    freed += entry.size;
    toDelete.push(entry.resourceId);
  }

  for (const rid of toDelete) {
    try {
      await fs.unlink(entryFilePath(rid));
    } catch { /* already gone */ }
    delete index.entries[rid];
  }

  index.totalSize = Object.values(index.entries).reduce((s, e) => s + e.size, 0);
  await saveIndex(index);

  console.log(
    `[download-cache] Evicted ${toDelete.length} files, freed ${(freed / 1024 / 1024).toFixed(1)} MB`,
  );
}

/**
 * Get cache statistics for monitoring.
 */
export async function getCacheStats(): Promise<{
  totalSize: number;
  maxSize: number;
  entryCount: number;
  utilizationPercent: number;
}> {
  const index = await loadIndex();
  const maxSize = MAX_CACHE_BYTES();
  return {
    totalSize: index.totalSize,
    maxSize,
    entryCount: Object.keys(index.entries).length,
    utilizationPercent: maxSize > 0 ? Math.round((index.totalSize / maxSize) * 100) : 0,
  };
}

/**
 * Create a read stream for a cached file (for use in API routes).
 */
export { createReadStream };
