/**
 * datagouv-mcp — MCP server for 73k+ French open datasets.
 * Intelligent search powered by Mistral AI + faceted catalog.
 *
 * Usage:
 *   npm run dev    — Run with tsx (development)
 *   npm start      — Run compiled (production)
 *
 * Transport: stdio (standard for Claude, Claude Code, Claude Cowork)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[datagouv-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[datagouv-mcp] Fatal error:", err);
  process.exit(1);
});
