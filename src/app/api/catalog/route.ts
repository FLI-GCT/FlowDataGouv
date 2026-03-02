import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { Catalog } from "@/lib/sync/catalog";

let cached: { data: Catalog; mtime: number } | null = null;

/**
 * GET /api/catalog
 *
 * Serves the pre-computed catalog from data/catalog.json.
 * Caches in memory and refreshes if file changed.
 * May be large (10-20MB) for 70k+ datasets — relies on gzip.
 */
export async function GET() {
  const filePath = path.join(process.cwd(), "data", "catalog.json");

  try {
    const stat = await fs.stat(filePath);
    const mtime = stat.mtimeMs;

    // Return cached if file hasn't changed
    if (cached && cached.mtime === mtime) {
      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": "public, max-age=600, stale-while-revalidate=300",
        },
      });
    }

    const raw = await fs.readFile(filePath, "utf-8");
    const data: Catalog = JSON.parse(raw);
    cached = { data, mtime };

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=600, stale-while-revalidate=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Catalogue non disponible. Lancez la synchronisation." },
      { status: 404 }
    );
  }
}
