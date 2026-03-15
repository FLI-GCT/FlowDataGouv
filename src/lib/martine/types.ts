/** Martine v2 — Types shared across the agent */

export interface MartineSession {
  id: string;
  messages: MartineMessage[];
  createdAt: number;
  lastActiveAt: number;
}

export type MartineMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: MartineToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

export interface MartineToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export type SSEEvent =
  | { event: "delta"; data: { content: string } }
  | { event: "done"; data: { content: string } }
  | { event: "error"; data: { message: string } }
  | { event: "tool_start"; data: { tool: string } }
  | { event: "tool_end"; data: { tool: string; durationMs: number } }
  | { event: "tool_result"; data: { tool: string; result: unknown } }
  | { event: "thinking"; data: { step: string } };

/** Tool call trace for frontend display */
export interface ToolTrace {
  tool: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  result?: unknown;
}

/** Structured resource for frontend rendering */
export interface ResourceCard {
  id: string;
  title: string;
  format: string;
  size?: string;
  tabular: boolean;
  datasetId: string;
  datasetTitle: string;
  url?: string;
}

/** Structured search result for frontend rendering */
export interface DatasetCard {
  number: number;
  id: string;
  title: string;
  type: string;
  organization: string;
  category: string;
  summary: string;
  views: number;
  downloads: number;
  lastModified: string;
  license: string;
  url: string;
  explorableCount: number;
  tabularResources: { id: string; title: string; format: string }[];
}
