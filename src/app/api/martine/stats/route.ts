import { NextResponse } from "next/server";
import { aggregateMartineStats } from "@/lib/martine/logger";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "7"), 90);

  try {
    const stats = await aggregateMartineStats(days);
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 },
    );
  }
}
