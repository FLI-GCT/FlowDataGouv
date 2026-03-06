import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/datagouv/api";

export const runtime = "nodejs";

// ── Server-side cache: one check per 60s shared across all requests ──

interface CachedStatus {
  online: boolean;
  latency?: number;
  error?: string;
  checkedAt: string;
}

let cached: CachedStatus | null = null;
let cachedAt = 0;
let inflight: Promise<CachedStatus> | null = null;
const TTL = 60_000; // 60s

async function getStatus(): Promise<CachedStatus> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL) return cached;

  // Deduplicate concurrent requests
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const health = await checkHealth();
      cached = {
        online: health.online,
        latency: health.latency,
        error: health.error,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      cached = {
        online: false,
        error: error instanceof Error ? error.message : "Health check failed",
        checkedAt: new Date().toISOString(),
      };
    }
    cachedAt = Date.now();
    inflight = null;
    return cached!;
  })();

  return inflight;
}

export async function GET() {
  const status = await getStatus();
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
    },
    status: status.online ? 200 : 503,
  });
}
