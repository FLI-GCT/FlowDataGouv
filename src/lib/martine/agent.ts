/**
 * Martine v2 — Core agent loop with Mistral tool calling.
 *
 * Phase 1: Non-streaming tool calling loop (complete → execute tools → repeat)
 * Phase 2: Streaming final response (stream → SSE to client)
 */

import { Mistral } from "@mistralai/mistralai";
import { TOOL_DEFINITIONS, executeTool } from "./tools";
import { MARTINE_SYSTEM_PROMPT } from "./system-prompt";
import { getOrCreateSession, appendMessages, getMessages } from "./sessions";
import { logToolCall, logConversation, logError } from "./logger";
import type { MartineMessage, SSEEvent } from "./types";

const MARTINE_MODEL = process.env.MARTINE_MODEL || "mistral-small-latest";
const MAX_TOOL_ROUNDS = 5;

let mistralClient: Mistral | null = null;

function getMistral(): Mistral {
  if (!mistralClient) {
    const key = process.env.MISTRAL_API_KEY;
    if (!key) throw new Error("MISTRAL_API_KEY non configurée");
    mistralClient = new Mistral({ apiKey: key });
  }
  return mistralClient;
}

export function isConfigured(): boolean {
  return !!process.env.MISTRAL_API_KEY;
}

export async function* runAgent(
  sessionId: string,
  userMessage: string,
): AsyncGenerator<SSEEvent> {
  const mistral = getMistral();
  const session = getOrCreateSession(sessionId);
  const agentStart = Date.now();

  // Ensure system prompt is first message
  if (session.messages.length === 0) {
    appendMessages(sessionId, [{ role: "system", content: MARTINE_SYSTEM_PROMPT }]);
  }

  // Append user message
  appendMessages(sessionId, [{ role: "user", content: userMessage }]);

  // Build messages for API (with sliding window)
  const messages = getMessages(sessionId);

  // Convert to Mistral format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiMessages: any[] = messages.map(toMistralMessage);

  // ── Phase 1: Tool calling loop (non-streaming) ────────────────

  const thinkingSteps = [
    "Analyse de la demande",
    "Recherche des informations",
    "Vérification des résultats",
    "Structuration de la réponse",
    "Finalisation",
  ];

  let toolRound = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const newMessages: MartineMessage[] = [];

  while (toolRound < MAX_TOOL_ROUNDS) {
    // Emit thinking status before each Mistral call
    yield { event: "thinking", data: { step: thinkingSteps[Math.min(toolRound, thinkingSteps.length - 1)] } };

    const response = await mistral.chat.complete({
      model: MARTINE_MODEL,
      messages: apiMessages,
      tools: TOOL_DEFINITIONS,
      toolChoice: "auto",
      temperature: 0.3,
      maxTokens: 4096,
    });

    const choice = response.choices?.[0];
    if (!choice) break;

    // Track token usage
    const usage = response.usage;
    if (usage) {
      totalInputTokens += usage.promptTokens || 0;
      totalOutputTokens += usage.completionTokens || 0;
    }

    const msg = choice.message;
    const content = typeof msg?.content === "string" ? msg.content : null;
    const toolCalls = msg?.toolCalls;

    // If no tool calls → we have the final answer (or empty), go to Phase 2
    if (choice.finishReason !== "tool_calls" || !toolCalls?.length) {
      // If the model already gave a text answer in Phase 1, emit it directly
      if (content) {
        const assistantMsg: MartineMessage = { role: "assistant", content };
        newMessages.push(assistantMsg);
        appendMessages(sessionId, newMessages);
        logConversation(sessionId, userMessage, toolRound, Date.now() - agentStart, MARTINE_MODEL,
          { input: totalInputTokens, output: totalOutputTokens }, content.length);
        yield { event: "done", data: { content } };
        return;
      }
      break; // No content, no tool calls → proceed to Phase 2
    }

    // Record assistant message with tool calls
    const assistantMsg: MartineMessage = {
      role: "assistant",
      content: content,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        function: {
          name: tc.function?.name || "unknown",
          arguments: typeof tc.function?.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || {}),
        },
      })),
    };
    newMessages.push(assistantMsg);
    apiMessages.push(toMistralMessage(assistantMsg));

    // Execute each tool call
    for (const tc of assistantMsg.toolCalls!) {
      const fnName = tc.function.name;
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse(tc.function.arguments);
      } catch { /* malformed args */ }

      yield { event: "tool_start", data: { tool: fnName } };

      const t0 = Date.now();
      const result = await executeTool(fnName, fnArgs);
      const durationMs = Date.now() - t0;

      // Log tool call
      const isErr = result.includes('"error"');
      logToolCall(
        sessionId, fnName, fnArgs,
        isErr ? "error" : "ok",
        durationMs, result.length,
        isErr ? (JSON.parse(result).error || undefined) : undefined,
      );

      yield { event: "tool_end", data: { tool: fnName, durationMs } };

      // Send structured data to frontend for rich rendering
      try {
        const parsed = JSON.parse(result);
        yield { event: "tool_result", data: { tool: fnName, result: parsed } };
      } catch { /* not JSON, skip */ }

      const toolMsg: MartineMessage = {
        role: "tool",
        content: compressForLLM(fnName, result),
        toolCallId: tc.id,
        name: fnName,
      };
      newMessages.push(toolMsg);
      apiMessages.push(toMistralMessage(toolMsg));
    }

    toolRound++;
  }

  // ── Phase 2: Stream final response ────────────────────────────

  yield { event: "thinking", data: { step: "Rédaction de la réponse" } };

  const stream = await mistral.chat.stream({
    model: MARTINE_MODEL,
    messages: apiMessages,
    temperature: 0.3,
    maxTokens: 4096,
  });

  let fullContent = "";

  for await (const event of stream) {
    const delta = event.data?.choices?.[0]?.delta;
    if (delta?.content && typeof delta.content === "string") {
      fullContent += delta.content;
      yield { event: "delta", data: { content: delta.content } };
    }
    // Track streaming usage (last chunk often has it)
    const streamUsage = event.data?.usage;
    if (streamUsage) {
      totalInputTokens += streamUsage.promptTokens || 0;
      totalOutputTokens += streamUsage.completionTokens || 0;
    }
  }

  // Record final assistant message
  if (fullContent) {
    newMessages.push({ role: "assistant", content: fullContent });
  }

  appendMessages(sessionId, newMessages);
  logConversation(sessionId, userMessage, toolRound, Date.now() - agentStart, MARTINE_MODEL,
    { input: totalInputTokens, output: totalOutputTokens }, fullContent.length);
  yield { event: "done", data: { content: fullContent } };
}

// ── LLM Response Compression ─────────────────────────────────

/**
 * Compress tool results for Mistral context (save tokens).
 * The frontend gets the FULL data via tool_result SSE event.
 * Mistral only needs enough info to reason and compose a response.
 */
function compressForLLM(toolName: string, fullResult: string): string {
  try {
    const data = JSON.parse(fullResult);

    switch (toolName) {
      case "search_datasets": {
        // Strip URLs, licenses, downloads — frontend already has them
        const results = (data.results || []).slice(0, 8).map((r: Record<string, unknown>) => ({
          number: r.number,
          id: r.id,
          title: r.title,
          organization: r.organization,
          category: r.category,
          explorableCount: r.explorableCount,
        }));
        return JSON.stringify({ query: data.query, total: data.total, results });
      }

      case "dataset_details": {
        // Truncate description, simplify resources
        const resources = (data.resources || []).map((r: Record<string, unknown>) => ({
          id: r.id,
          title: (r.title as string)?.slice(0, 50),
          format: r.format,
          tabular: r.tabular,
        }));
        return JSON.stringify({
          id: data.id,
          title: data.title,
          organization: data.organization,
          description: data.description?.slice(0, 200),
          explorableCount: data.explorableCount,
          resources,
          metrics: data.metrics,
        });
      }

      case "query_data": {
        // Max 5 rows for LLM (frontend shows all), columns name+type only
        return JSON.stringify({
          resource_id: data.resource_id,
          columns: data.columns,
          totalColumns: data.totalColumns,
          rows: (data.rows || []).slice(0, 5),
          totalRows: data.totalRows,
          hasMore: data.hasMore,
          filters: data.filters,
          corrections: data.corrections,
          error: data.error,
          suggestion: data.suggestion,
        });
      }

      case "search_sirene": {
        // Keep results compact
        const results = (data.results || []).slice(0, 10).map((r: Record<string, unknown>) => ({
          siren: r.siren,
          denomination: r.denomination,
          activite_principale: r.activite_principale,
          etat_administratif: r.etat_administratif,
        }));
        return JSON.stringify({ query: data.query, total: data.total, results });
      }

      case "compare_data": {
        const comps = (data.comparisons || []).map((c: Record<string, unknown>) => ({
          label: c.label,
          dataset: c.dataset ? { title: (c.dataset as Record<string, unknown>).title } : null,
          rows: ((c.rows as Record<string, string>[]) || []).slice(0, 3),
          totalRows: c.totalRows,
          searchColumn: c.searchColumn,
          error: c.error,
        }));
        return JSON.stringify({ comparisons: comps });
      }

      case "search_and_preview": {
        // Compress datasets: keep id, title, org, matching rows (max 3)
        const datasets = (data.datasets || []).map((ds: Record<string, unknown>) => ({
          id: ds.id,
          title: ds.title,
          organization: ds.organization,
          resource: ds.resource,
          searchColumn: ds.searchColumn,
          matchingRows: ((ds.matchingRows as Record<string, string>[]) || []).slice(0, 3),
          totalRows: ds.totalRows,
        }));
        return JSON.stringify({
          query: data.query,
          data_query: data.data_query,
          total: data.total,
          datasets,
        });
      }

      default:
        // For other tools (categories, catalog_stats), return as-is (already compact)
        return fullResult;
    }
  } catch {
    return fullResult;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMistralMessage(msg: MartineMessage): any {
  switch (msg.role) {
    case "system":
      return { role: "system", content: msg.content };
    case "user":
      return { role: "user", content: msg.content };
    case "assistant":
      return {
        role: "assistant",
        content: msg.content ?? "",
        ...(msg.toolCalls?.length
          ? {
              toolCalls: msg.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.function.name, arguments: tc.function.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return {
        role: "tool",
        content: msg.content,
        toolCallId: msg.toolCallId,
        name: msg.name,
      };
  }
}
