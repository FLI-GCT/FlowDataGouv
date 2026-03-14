/**
 * Structured NDJSON logger for MCP tool calls.
 * Writes one JSON line per tool call to a dedicated file,
 * and keeps human-readable output on stderr.
 */

import { createWriteStream, type WriteStream } from "node:fs";

const LOG_PATH = process.env.MCP_LOG_FILE || "";
let stream: WriteStream | null = null;

function getStream(): WriteStream | null {
  if (!LOG_PATH) return null;
  if (!stream) {
    stream = createWriteStream(LOG_PATH, { flags: "a" });
    stream.on("error", (err) => {
      console.error(`[mcp-log] Write error: ${err.message}`);
      stream = null;
    });
  }
  return stream;
}

export interface ToolLogEntry {
  ts: string;
  tool: string;
  args: Record<string, unknown>;
  status: "ok" | "error";
  duration_ms: number;
  error_message?: string;
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + "...";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function logToolCall(
  tool: string,
  args: Record<string, unknown>,
  status: "ok" | "error",
  durationMs: number,
  errorMessage?: string,
): void {
  const sanitized = sanitizeArgs(args);

  // NDJSON to file
  const entry: ToolLogEntry = {
    ts: new Date().toISOString(),
    tool,
    args: sanitized,
    status,
    duration_ms: durationMs,
  };
  if (errorMessage) entry.error_message = errorMessage;

  const s = getStream();
  if (s) {
    try { s.write(JSON.stringify(entry) + "\n"); } catch { /* best-effort */ }
  }

  // Human-readable to stderr (preserves existing format)
  const argsStr = Object.entries(sanitized)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`)
    .join(", ");
  if (status === "ok") {
    console.error(`[mcp] ${tool}(${argsStr}) → ok (${durationMs}ms)`);
  } else {
    console.error(`[mcp] ${tool} → ERROR: ${errorMessage} (${durationMs}ms)`);
  }
}

export function closeLog(): void {
  stream?.end();
  stream = null;
}

/**
 * Read and aggregate NDJSON log entries for the last N days.
 */
export async function aggregateStats(days = 7): Promise<{
  period: { from: string; to: string };
  total_calls: number;
  total_errors: number;
  error_rate: string;
  by_tool: { tool: string; calls: number; errors: number; avg_ms: number }[];
  daily: { date: string; calls: number; errors: number }[];
  top_queries: { query: string; count: number }[];
  recent_errors: { ts: string; tool: string; error: string }[];
}> {
  if (!LOG_PATH) {
    return {
      period: { from: "", to: "" },
      total_calls: 0, total_errors: 0, error_rate: "0%",
      by_tool: [], daily: [], top_queries: [], recent_errors: [],
    };
  }

  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  const toolMap = new Map<string, { calls: number; errors: number; totalMs: number }>();
  const dailyMap = new Map<string, { calls: number; errors: number }>();
  const queryMap = new Map<string, number>();
  const recentErrors: { ts: string; tool: string; error: string }[] = [];
  let totalCalls = 0;
  let totalErrors = 0;

  const rl = createInterface({
    input: createReadStream(LOG_PATH, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: ToolLogEntry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.ts < cutoffIso) continue;

    totalCalls++;
    const date = entry.ts.slice(0, 10);

    // By tool
    const t = toolMap.get(entry.tool) || { calls: 0, errors: 0, totalMs: 0 };
    t.calls++;
    t.totalMs += entry.duration_ms;
    if (entry.status === "error") { t.errors++; totalErrors++; }
    toolMap.set(entry.tool, t);

    // Daily
    const d = dailyMap.get(date) || { calls: 0, errors: 0 };
    d.calls++;
    if (entry.status === "error") d.errors++;
    dailyMap.set(date, d);

    // Top queries (smart_search)
    if (entry.tool === "datagouv_smart_search" && typeof entry.args.query === "string") {
      const q = entry.args.query;
      queryMap.set(q, (queryMap.get(q) || 0) + 1);
    }

    // Recent errors
    if (entry.status === "error") {
      recentErrors.push({ ts: entry.ts, tool: entry.tool, error: entry.error_message || "unknown" });
      if (recentErrors.length > 20) recentErrors.shift();
    }
  }

  const byTool = [...toolMap.entries()]
    .map(([tool, s]) => ({ tool, calls: s.calls, errors: s.errors, avg_ms: Math.round(s.totalMs / s.calls) }))
    .sort((a, b) => b.calls - a.calls);

  const daily = [...dailyMap.entries()]
    .map(([date, s]) => ({ date, calls: s.calls, errors: s.errors }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topQueries = [...queryMap.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const now = new Date().toISOString().slice(0, 10);
  return {
    period: { from: cutoffIso.slice(0, 10), to: now },
    total_calls: totalCalls,
    total_errors: totalErrors,
    error_rate: totalCalls ? `${((totalErrors / totalCalls) * 100).toFixed(1)}%` : "0%",
    by_tool: byTool,
    daily,
    top_queries: topQueries,
    recent_errors: recentErrors.slice(-10),
  };
}
