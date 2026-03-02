/**
 * GET /api/download/stats — Download cache statistics.
 */

import { NextResponse } from "next/server";
import { getCacheStats } from "@/lib/cache/download-cache";

export async function GET() {
  try {
    const stats = await getCacheStats();
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json({ error: "Cache non disponible" }, { status: 500 });
  }
}
