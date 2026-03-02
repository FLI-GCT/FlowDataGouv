/**
 * MCP server setup — registers all tools with @modelcontextprotocol/sdk.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { allTools } from "./tools/index.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "datagouv-mcp",
    version: "2.0.0",
  });

  for (const tool of allTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape,
      async (args) => {
        const t0 = Date.now();
        try {
          const argsStr = Object.entries(args as Record<string, unknown>)
            .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`)
            .join(", ");
          const content = await tool.handler(args as Record<string, unknown>);
          console.error(`[mcp] ${tool.name}(${argsStr}) → ok (${Date.now() - t0}ms)`);
          return { content };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[mcp] ${tool.name} → ERROR: ${message} (${Date.now() - t0}ms)`);
          // Return error as informational text (NOT isError: true)
          // to avoid "Sibling tool call errored" cascade in Claude Desktop
          // when multiple tools are called in parallel.
          return {
            content: [{ type: "text" as const, text: `⚠️ ${tool.name}: ${message}` }],
          };
        }
      }
    );
  }

  console.error(`[datagouv-mcp] Registered ${allTools.length} tools`);
  return server;
}
