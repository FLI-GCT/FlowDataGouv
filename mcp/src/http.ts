/**
 * datagouv-mcp — HTTP transport (Streamable HTTP).
 *
 * Expose le MCP server en HTTP pour un déploiement serveur.
 * Gère POST (messages), GET (SSE stream) et DELETE (session close).
 *
 * Usage :
 *   npm run start:http
 *
 * Env :
 *   MCP_PORT=8000 (défaut)
 *   FLOWDATA_URL=http://localhost:3000
 *   MCP_LOG_FILE=/var/log/flowdatagouv/mcp-tools.ndjson
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.js";
import { closeLog, aggregateStats } from "./lib/logger.js";

const PORT = parseInt(process.env.MCP_PORT || "8000", 10);

const app = createMcpExpressApp();

// Sessions actives
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp — messages JSON-RPC
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Nouvelle session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) delete transports[sid];
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session ID manquant ou requête invalide" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp-http] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Erreur interne" },
        id: null,
      });
    }
  }
});

// GET /mcp — SSE stream
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Session invalide");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// DELETE /mcp — fermeture session
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Session invalide");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// GET /health — health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "2.0.0" });
});

// GET /stats — MCP tool usage statistics
app.get("/stats", async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(String(req.query.days) || "7", 10) || 7, 90);
    const stats = await aggregateStats(days);
    res.json(stats);
  } catch (error) {
    console.error("[mcp-http] Stats error:", error);
    res.status(500).json({ error: "Failed to aggregate stats" });
  }
});

app.listen(PORT, () => {
  console.error(`[datagouv-mcp] HTTP server listening on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  closeLog();
  for (const sid of Object.keys(transports)) {
    try {
      await transports[sid].close();
      delete transports[sid];
    } catch {}
  }
  process.exit(0);
});
