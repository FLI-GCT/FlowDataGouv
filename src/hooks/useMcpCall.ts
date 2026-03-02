"use client";

import { useState, useCallback, useRef } from "react";
import { parseToolResult, type ParsedToolResult } from "@/lib/parsers";

interface UseMcpCallResult<T extends ParsedToolResult = ParsedToolResult> {
  data: T | null;
  rawData: unknown;
  isLoading: boolean;
  error: string | null;
  call: (tool: string, args: Record<string, unknown>) => Promise<T | null>;
  reset: () => void;
}

/**
 * Hook for direct data.gouv.fr API calls.
 * Calls /api/datagouv/call which returns structured data directly.
 * Falls back to text parsing only if `parsed` flag is absent (legacy).
 */
export function useMcpCall<T extends ParsedToolResult = ParsedToolResult>(): UseMcpCallResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [rawData, setRawData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const call = useCallback(async (tool: string, args: Record<string, unknown>): Promise<T | null> => {
    // Cancel any in-flight request
    abortRef.current?.abort();

    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/datagouv/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Erreur HTTP ${response.status}`);
      }

      const json = await response.json();
      setRawData(json.result);

      // If the API returned pre-parsed structured data, use it directly
      let parsed: T;
      if (json.parsed) {
        parsed = json.result as T;
      } else {
        parsed = parseToolResult(tool, json.result) as T;
      }

      setData(parsed);
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return null;
      }
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setData(null);
    setRawData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, rawData, isLoading, error, call, reset };
}
