import { NextResponse } from "next/server";

interface ProxyRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
}

/** Block private/internal IPs to prevent SSRF */
function isPrivateHost(hostname: string): boolean {
  // Block obvious private patterns
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.") ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }
  return false;
}

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Must be HTTPS (or HTTP for gov domains)
    if (!["https:", "http:"].includes(parsed.protocol)) return false;
    // Block private IPs
    if (isPrivateHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: ProxyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.url || !body.method) {
    return NextResponse.json(
      { error: "url and method required" },
      { status: 400 }
    );
  }

  if (!isAllowedUrl(body.url)) {
    return NextResponse.json(
      { error: "URL non autorisee (protocole invalide ou hote prive)" },
      { status: 403 }
    );
  }

  const targetUrl = new URL(body.url);
  if (body.queryParams) {
    for (const [key, value] of Object.entries(body.queryParams)) {
      if (value) targetUrl.searchParams.set(key, value);
    }
  }

  const startTime = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method: body.method.toUpperCase(),
      headers: {
        Accept: "application/json, text/html, */*",
        "User-Agent": "FlowDataGouv/1.0",
        ...(body.headers || {}),
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    };

    if (
      body.body &&
      ["POST", "PUT", "PATCH"].includes(body.method.toUpperCase())
    ) {
      fetchOptions.body = JSON.stringify(body.body);
      (fetchOptions.headers as Record<string, string>)["Content-Type"] =
        "application/json";
    }

    const res = await fetch(targetUrl.toString(), fetchOptions);
    const duration = Date.now() - startTime;

    const contentType = res.headers.get("content-type") || "";

    // For binary/file content, don't try to read as text — report metadata
    const isBinary =
      contentType.includes("zip") ||
      contentType.includes("octet-stream") ||
      contentType.includes("gzip") ||
      contentType.includes("pdf") ||
      contentType.includes("image/");

    let responseBody: unknown;
    if (isBinary) {
      const size = res.headers.get("content-length");
      responseBody = `[Fichier binaire — ${contentType.split(";")[0]}${size ? `, ${(parseInt(size) / 1024 / 1024).toFixed(1)} Mo` : ""}]`;
    } else if (contentType.includes("json")) {
      responseBody = await res.json();
    } else {
      const text = await res.text();
      // Truncate very large text responses
      responseBody = text.length > 50_000 ? text.substring(0, 50_000) + "\n...(tronque)" : text;
    }

    const responseHeaders: Record<string, string> = {};
    for (const key of [
      "content-type",
      "content-length",
      "content-disposition",
      "x-total",
      "x-total-count",
      "link",
      "server",
    ]) {
      const val = res.headers.get(key);
      if (val) responseHeaders[key] = val;
    }

    return NextResponse.json({
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body: responseBody,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    return NextResponse.json(
      {
        status: 0,
        statusText: "Network Error",
        headers: {},
        body: error instanceof Error ? error.message : "Erreur reseau",
        duration,
      },
      { status: 502 }
    );
  }
}
