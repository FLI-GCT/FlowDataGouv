import { NextResponse } from "next/server";
import {
  analyzeSearchResults,
  type DatasetSummary,
} from "@/lib/search/analyze";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

interface AnalyzeRequest {
  query: string;
  datasets: DatasetSummary[];
}

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

  let body: AnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.query || !Array.isArray(body.datasets)) {
    return NextResponse.json(
      { error: "query and datasets required" },
      { status: 400 }
    );
  }

  try {
    const result = await analyzeSearchResults(body.query, body.datasets);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[search/analyze] Error:", error);
    return NextResponse.json({ summary: "", groups: [], insights: [] });
  }
}
