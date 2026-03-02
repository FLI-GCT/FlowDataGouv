export interface ApiError {
  error: string;
  remaining?: number;
  reset?: number;
}

export interface McpCallRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface McpCallResponse {
  result: unknown;
}

export interface HealthResponse {
  status: "ok";
  timestamp: string;
  version: string;
}
