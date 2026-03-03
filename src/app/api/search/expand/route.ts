import { NextResponse } from "next/server";
import { expandSearchQuery } from "@/lib/search/expand";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const rl = checkRateLimit(getClientIp(request));
  if (!rl.success) {
    return NextResponse.json(
      { error: "Trop de requêtes. Réessayez dans 24h." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.reset),
          "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)),
        },
      }
    );
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.query || typeof body.query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const result = await expandSearchQuery(body.query);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[search/expand] Error:", error);
    // Fallback: return original query
    return NextResponse.json({
      original: body.query,
      corrected: body.query,
      keywords: [body.query],
      wasExpanded: false,
    });
  }
}
