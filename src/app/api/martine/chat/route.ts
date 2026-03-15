/**
 * POST /api/martine/chat — Martine v2 agent with Mistral tool calling.
 * Streams SSE events: tool_start, tool_end, delta, done, error.
 */

import { runAgent, isConfigured } from "@/lib/martine/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isConfigured()) {
    return new Response(
      "event: error\ndata: " +
        JSON.stringify({ message: "Martine n'est pas disponible (MISTRAL_API_KEY manquante)." }) +
        "\n\n",
      { status: 503, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  let body: { sessionId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const sessionId = body.sessionId;
  const message = body.message?.trim();

  if (!sessionId || !message) {
    return new Response(JSON.stringify({ error: "sessionId and message required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(sessionId, message)) {
          const sse = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(sse));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur interne";
        const sse = `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`;
        controller.enqueue(encoder.encode(sse));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
