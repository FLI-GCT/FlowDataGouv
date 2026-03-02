export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "done" | "error";
}

export type StreamEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_call_start"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_call_result"; id: string; tool: string; data: unknown }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { input_tokens: number; output_tokens: number } }
  | { type: "rate_limit"; remaining: number };

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
}
