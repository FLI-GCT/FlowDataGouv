import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/datagouv/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const health = await checkHealth();
    return NextResponse.json(
      {
        online: health.online,
        latency: health.latency,
        error: health.error,
        checkedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=15",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        online: false,
        error:
          error instanceof Error ? error.message : "Health check failed",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
