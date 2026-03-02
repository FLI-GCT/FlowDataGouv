/**
 * GET /api/download/[resourceId] — Download proxy with LRU disk cache.
 *
 * Cache hit  → streams from disk, updates lastAccessed.
 * Cache miss → fetches resource metadata from data.gouv.fr, downloads,
 *              caches to disk, streams to client.
 * Fallback   → redirects to original data.gouv.fr URL on error.
 */

import { NextResponse } from "next/server";
import { getCachedPath, cacheResource, createReadStream } from "@/lib/cache/download-cache";
import { Readable } from "stream";

const DATAGOUV_API = "https://www.data.gouv.fr/api/";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const { resourceId } = await params;

  // Validate UUID format
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(resourceId)) {
    return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  try {
    // 1. Check cache
    const cached = await getCachedPath(resourceId);
    if (cached) {
      return streamFile(cached.filePath, cached.entry.filename, cached.entry.contentType, "HIT");
    }

    // 2. Cache miss — get resource metadata
    const metaRes = await fetch(
      `${DATAGOUV_API}2/datasets/resources/${resourceId}/`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!metaRes.ok) {
      if (metaRes.status === 404) {
        return NextResponse.json({ error: "Ressource introuvable" }, { status: 404 });
      }
      return NextResponse.json({ error: `Erreur API: ${metaRes.status}` }, { status: 502 });
    }

    const meta = await metaRes.json();
    const resourceUrl = meta.resource?.url;
    if (!resourceUrl) {
      return NextResponse.json({ error: "Pas d'URL de telechargement" }, { status: 404 });
    }

    // 3. Download, cache, stream
    const result = await cacheResource(resourceId, resourceUrl);
    return streamFile(result.filePath, result.entry.filename, result.entry.contentType, "MISS");
  } catch (error) {
    console.error(`[download] ${resourceId} error:`, error);

    // Fallback: redirect to original URL
    try {
      const metaRes = await fetch(
        `${DATAGOUV_API}2/datasets/resources/${resourceId}/`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.resource?.url) {
          return NextResponse.redirect(meta.resource.url, 302);
        }
      }
    } catch { /* fallthrough */ }

    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function streamFile(
  filePath: string,
  filename: string,
  contentType: string,
  cacheStatus: "HIT" | "MISS",
): Response {
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  const safeFilename = filename.replace(/[^\w.\-]/g, "_");

  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Cache": cacheStatus,
    },
  });
}
