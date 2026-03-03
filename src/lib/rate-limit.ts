import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);

// Anonymize IP: zero last octet (IPv4) or last group (IPv6), consistent with Nginx logs
export function anonymizeIp(ip: string): string {
  if (ip.includes(":")) {
    // IPv6 — zero last group
    const parts = ip.split(":");
    parts[parts.length - 1] = "0";
    return parts.join(":");
  }
  // IPv4 — zero last octet
  const parts = ip.split(".");
  if (parts.length === 4) {
    parts[3] = "0";
    return parts.join(".");
  }
  return ip;
}

export function checkRateLimit(ip: string): {
  success: boolean;
  remaining: number;
  reset: number;
} {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { success: true, remaining: RATE_LIMIT_MAX - 1, reset: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    console.error(`[rate-limit] 429 ip=${anonymizeIp(ip)} count=${entry.count} reset=${new Date(entry.resetAt).toISOString()}`);
    return { success: false, remaining: 0, reset: entry.resetAt };
  }

  entry.count++;
  return {
    success: true,
    remaining: RATE_LIMIT_MAX - entry.count,
    reset: entry.resetAt,
  };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "127.0.0.1";
}
