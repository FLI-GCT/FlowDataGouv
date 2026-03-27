/**
 * Structured NDJSON logger for Martine agent.
 * Logs conversations, tool calls, and session events.
 * Compatible with MCP logger pattern for unified stats.
 */

import { appendFileSync } from "node:fs";

const LOG_PATH = process.env.MARTINE_LOG_FILE || "";

// ── Types ────────────────────────────────────────────────────────

export interface MartineLogEntry {
  ts: string;
  type: "conversation" | "tool_call" | "session" | "error";
  session_id: string;
  // conversation fields
  query?: string;
  tool_rounds?: number;
  total_ms?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  response_length?: number;
  // tool_call fields
  tool?: string;
  args?: Record<string, unknown>;
  status?: "ok" | "error";
  duration_ms?: number;
  result_size?: number;
  error_message?: string;
  // session fields
  event?: string;
  message_count?: number;
  active_sessions?: number;
}

// ── Write ────────────────────────────────────────────────────────

function writeLog(entry: MartineLogEntry): void {
  if (!LOG_PATH) return;
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch { /* best-effort */ }

  // Also log to stderr for PM2 logs
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  switch (entry.type) {
    case "conversation": {
      const tkn = entry.input_tokens ? ` tokens=${entry.input_tokens}→${entry.output_tokens}` : "";
      const resp = entry.response_length ? ` resp=${entry.response_length}ch` : "";
      console.error(`${ts}: [martine] query="${entry.query}" tools=${entry.tool_rounds} ${entry.total_ms}ms ${entry.model}${tkn}${resp}`);
      break;
    }
    case "tool_call":
      if (entry.status === "ok") {
        console.error(`${ts}: [martine] ${entry.tool}(${fmtArgs(entry.args)}) → ok (${entry.duration_ms}ms, ${entry.result_size} chars)`);
      } else {
        console.error(`${ts}: [martine] ${entry.tool} → ERROR: ${entry.error_message} (${entry.duration_ms}ms)`);
      }
      break;
    case "session":
      console.error(`${ts}: [martine] session ${entry.event} ${entry.session_id.slice(0, 8)}… (${entry.message_count} msgs, ${entry.active_sessions} active)`);
      break;
    case "error":
      console.error(`${ts}: [martine] ERROR: ${entry.error_message}`);
      break;
  }
}

function fmtArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s && s.length > 60 ? s.slice(0, 60) + "…" : s}`;
    })
    .join(", ");
}

// ── Public API ───────────────────────────────────────────────────

export function logToolCall(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  status: "ok" | "error",
  durationMs: number,
  resultSize: number,
  errorMessage?: string,
): void {
  writeLog({
    ts: new Date().toISOString(),
    type: "tool_call",
    session_id: sessionId,
    tool,
    args: sanitize(args),
    status,
    duration_ms: durationMs,
    result_size: resultSize,
    error_message: errorMessage,
  });
}

export function logConversation(
  sessionId: string,
  query: string,
  toolRounds: number,
  totalMs: number,
  model: string,
  tokens?: { input: number; output: number },
  responseLength?: number,
): void {
  writeLog({
    ts: new Date().toISOString(),
    type: "conversation",
    session_id: sessionId,
    query: query.length > 200 ? query.slice(0, 200) + "…" : query,
    tool_rounds: toolRounds,
    total_ms: totalMs,
    model,
    input_tokens: tokens?.input,
    output_tokens: tokens?.output,
    response_length: responseLength,
  });
}

export function logSession(
  sessionId: string,
  event: "created" | "expired" | "cleared",
  messageCount: number,
  activeSessions: number,
): void {
  writeLog({
    ts: new Date().toISOString(),
    type: "session",
    session_id: sessionId,
    event,
    message_count: messageCount,
    active_sessions: activeSessions,
  });
}

export function logError(sessionId: string, message: string): void {
  writeLog({
    ts: new Date().toISOString(),
    type: "error",
    session_id: sessionId,
    error_message: message,
  });
}

// ── Sanitize args (truncate long strings) ────────────────────────

function sanitize(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Stats aggregation ────────────────────────────────────────────

export async function aggregateMartineStats(days = 7): Promise<{
  period: { from: string; to: string };
  conversations: { total: number; avg_tool_rounds: string; avg_duration_ms: number; total_input_tokens: number; total_output_tokens: number; avg_response_length: number };
  tool_calls: { total: number; errors: number; error_rate: string };
  by_tool: { tool: string; calls: number; errors: number; avg_ms: number }[];
  daily: { date: string; conversations: number; tool_calls: number; errors: number }[];
  top_queries: { query: string; count: number }[];
  recent_errors: { ts: string; tool: string; error: string }[];
  sessions: { created: number; expired: number };
}> {
  const empty = {
    period: { from: "", to: "" },
    conversations: { total: 0, avg_tool_rounds: "0", avg_duration_ms: 0, total_input_tokens: 0, total_output_tokens: 0, avg_response_length: 0 },
    tool_calls: { total: 0, errors: 0, error_rate: "0%" },
    by_tool: [], daily: [], top_queries: [], recent_errors: [],
    sessions: { created: 0, expired: 0 },
  };

  if (!LOG_PATH) return empty;

  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");

  // Check file exists
  try {
    const { statSync } = await import("node:fs");
    statSync(LOG_PATH);
  } catch {
    return empty;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  const toolMap = new Map<string, { calls: number; errors: number; totalMs: number }>();
  const dailyMap = new Map<string, { convos: number; tools: number; errors: number }>();
  const queryMap = new Map<string, number>();
  const recentErrors: { ts: string; tool: string; error: string }[] = [];
  let totalConvos = 0, totalToolCalls = 0, totalToolErrors = 0;
  let totalRounds = 0, totalDuration = 0;
  let totalInputTokens = 0, totalOutputTokens = 0, totalResponseLength = 0;
  let sessCreated = 0, sessExpired = 0;

  const rl = createInterface({
    input: createReadStream(LOG_PATH, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: MartineLogEntry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.ts < cutoffIso) continue;

    const date = entry.ts.slice(0, 10);
    const d = dailyMap.get(date) || { convos: 0, tools: 0, errors: 0 };

    switch (entry.type) {
      case "conversation": {
        totalConvos++;
        totalRounds += entry.tool_rounds || 0;
        totalDuration += entry.total_ms || 0;
        totalInputTokens += entry.input_tokens || 0;
        totalOutputTokens += entry.output_tokens || 0;
        totalResponseLength += entry.response_length || 0;
        d.convos++;
        if (entry.query) queryMap.set(entry.query, (queryMap.get(entry.query) || 0) + 1);
        break;
      }
      case "tool_call": {
        totalToolCalls++;
        d.tools++;
        const t = toolMap.get(entry.tool!) || { calls: 0, errors: 0, totalMs: 0 };
        t.calls++;
        t.totalMs += entry.duration_ms || 0;
        if (entry.status === "error") {
          t.errors++; totalToolErrors++; d.errors++;
          recentErrors.push({ ts: entry.ts, tool: entry.tool!, error: entry.error_message || "unknown" });
          if (recentErrors.length > 20) recentErrors.shift();
        }
        toolMap.set(entry.tool!, t);
        break;
      }
      case "session":
        if (entry.event === "created") sessCreated++;
        if (entry.event === "expired") sessExpired++;
        break;
    }
    dailyMap.set(date, d);
  }

  const now = new Date().toISOString().slice(0, 10);
  return {
    period: { from: cutoffIso.slice(0, 10), to: now },
    conversations: {
      total: totalConvos,
      avg_tool_rounds: totalConvos ? (totalRounds / totalConvos).toFixed(1) : "0",
      avg_duration_ms: totalConvos ? Math.round(totalDuration / totalConvos) : 0,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      avg_response_length: totalConvos ? Math.round(totalResponseLength / totalConvos) : 0,
    },
    tool_calls: {
      total: totalToolCalls,
      errors: totalToolErrors,
      error_rate: totalToolCalls ? `${((totalToolErrors / totalToolCalls) * 100).toFixed(1)}%` : "0%",
    },
    by_tool: [...toolMap.entries()]
      .map(([tool, s]) => ({ tool, calls: s.calls, errors: s.errors, avg_ms: Math.round(s.totalMs / s.calls) }))
      .sort((a, b) => b.calls - a.calls),
    daily: [...dailyMap.entries()]
      .map(([date, s]) => ({ date, conversations: s.convos, tool_calls: s.tools, errors: s.errors }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    top_queries: [...queryMap.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    recent_errors: recentErrors.slice(-10),
    sessions: { created: sessCreated, expired: sessExpired },
  };
}
