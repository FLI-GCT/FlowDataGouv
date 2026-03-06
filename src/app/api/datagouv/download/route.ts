import { NextResponse } from "next/server";
import { getResourceInfo } from "@/lib/datagouv/api";
import { PREVIEW_MAX_BYTES } from "@/lib/constants";

const ALLOWED_TYPES = [
  "image/", "application/pdf", "text/xml", "application/xml",
  "application/json", "text/plain", "text/csv", "text/html",
];

function isAllowedType(ct: string): boolean {
  return ALLOWED_TYPES.some((t) => ct.startsWith(t));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resourceId = searchParams.get("resource_id");
  const inline = searchParams.get("inline") === "1";

  if (!resourceId) {
    return NextResponse.json({ error: "resource_id required" }, { status: 400 });
  }

  try {
    const info = await getResourceInfo(resourceId);
    if (!info.url) {
      return NextResponse.json({ error: "No download URL" }, { status: 404 });
    }

    const upstream = await fetch(info.url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream HTTP ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    if (contentLength && parseInt(contentLength) > PREVIEW_MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${Math.round(PREVIEW_MAX_BYTES / 1024 / 1024)} MB)` },
        { status: 413 },
      );
    }

    if (!isAllowedType(contentType)) {
      return NextResponse.json(
        { error: `Content type not allowed: ${contentType}` },
        { status: 415 },
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    };

    if (inline) {
      headers["Content-Disposition"] = "inline";
    }

    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    return new Response(upstream.body, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
