"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MartineChat } from "@/components/martine/MartineChat";

function MartinePageInner() {
  const searchParams = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const initialQuery = searchParams.get("q") || undefined;

  const initSession = useCallback(async () => {
    // Check sessionStorage first (temporary session)
    const stored = sessionStorage.getItem("martine_session");
    if (stored) {
      setSessionId(stored);
      return;
    }

    // Try to get from cookie (persistent session) or create new
    try {
      const res = await fetch("/api/martine/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      sessionStorage.setItem("martine_session", data.sessionId);
      setSessionId(data.sessionId);
    } catch {
      // Fallback: generate local ID
      const id = crypto.randomUUID();
      sessionStorage.setItem("martine_session", id);
      setSessionId(id);
    }
  }, []);

  useEffect(() => { initSession(); }, [initSession]);

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
      <MartineChat sessionId={sessionId} initialQuery={initialQuery} />
    </div>
  );
}

export default function MartinePage() {
  return (
    <Suspense fallback={
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <MartinePageInner />
    </Suspense>
  );
}
