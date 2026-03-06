import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------- In-memory rate limiter (per worker) ----------
// Nginx est la défense principale (30 req/min).
// Ce rate limiter applicatif est une défense secondaire par worker.
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "500", 10);
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

// Nettoyage des entrées expirées toutes les 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000);

function getIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

function checkLimit(ip: string) {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return {
      ok: true,
      remaining: RATE_LIMIT_MAX - 1,
      reset: now + RATE_LIMIT_WINDOW_MS,
    };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { ok: false, remaining: 0, reset: entry.resetAt };
  }

  entry.count++;
  return {
    ok: true,
    remaining: RATE_LIMIT_MAX - entry.count,
    reset: entry.resetAt,
  };
}

// ---------- Routes exclues du rate limiting ----------
const EXCLUDED = [
  "/api/health",
  "/api/mcp/status",
  "/api/datagouv/call",
  "/api/datagouv/download",
  "/api/download/",
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip rate limiting sur les routes de monitoring et GET catalog (cachées par Nginx)
  if (
    EXCLUDED.some((p) => pathname.startsWith(p)) ||
    (pathname === "/api/catalog" && req.method === "GET") ||
    (pathname === "/api/catalog/summary" && req.method === "GET")
  ) {
    return NextResponse.next();
  }

  const ip = getIp(req);
  const { ok, remaining, reset } = checkLimit(ip);

  if (!ok) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Trop de requêtes. Réessayez plus tard." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(reset / 1000)),
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(reset / 1000)));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
