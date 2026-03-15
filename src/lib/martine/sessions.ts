/** Martine v2 — In-memory session store with TTL and sliding window */

import type { MartineSession, MartineMessage } from "./types";

const SESSION_TTL = 30 * 60_000; // 30 minutes
const MAX_SESSIONS = 500;
const MAX_MESSAGES = 30; // sliding window (excluding system prompt)

const sessions = new Map<string, MartineSession>();

// Cleanup expired sessions every 60s
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActiveAt > SESSION_TTL) sessions.delete(id);
    }
  }, 60_000);
}

export function getOrCreateSession(sessionId: string): MartineSession {
  let session = sessions.get(sessionId);
  if (session) {
    session.lastActiveAt = Date.now();
    return session;
  }

  // Evict oldest if at capacity
  if (sessions.size >= MAX_SESSIONS) {
    let oldestId = "";
    let oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastActiveAt < oldestTime) {
        oldestTime = s.lastActiveAt;
        oldestId = id;
      }
    }
    if (oldestId) sessions.delete(oldestId);
  }

  session = {
    id: sessionId,
    messages: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function appendMessage(sessionId: string, msg: MartineMessage): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push(msg);
  session.lastActiveAt = Date.now();
}

export function appendMessages(sessionId: string, msgs: MartineMessage[]): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push(...msgs);
  session.lastActiveAt = Date.now();
}

/** Get messages with sliding window: system prompt + last MAX_MESSAGES */
export function getMessages(sessionId: string): MartineMessage[] {
  const session = sessions.get(sessionId);
  if (!session) return [];

  const msgs = session.messages;
  if (msgs.length <= MAX_MESSAGES + 1) return [...msgs]; // +1 for system prompt

  // Keep system prompt (first) + last MAX_MESSAGES
  const system = msgs[0]?.role === "system" ? [msgs[0]] : [];
  const recent = msgs.slice(-(MAX_MESSAGES));
  return [...system, ...recent];
}
