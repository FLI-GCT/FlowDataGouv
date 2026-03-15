import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";

const COOKIE_NAME = "martine_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export async function POST(request: Request) {
  let body: { persist?: boolean } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  const cookieStore = await cookies();
  const existingCookie = cookieStore.get(COOKIE_NAME);

  if (existingCookie?.value) {
    return NextResponse.json({ sessionId: existingCookie.value, isNew: false });
  }

  const sessionId = randomUUID();
  const response = NextResponse.json({ sessionId, isNew: true });

  if (body.persist) {
    response.cookies.set(COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
  }

  return response;
}

/** Upgrade a temporary session to persistent (set cookie) */
export async function PUT(request: Request) {
  let body: { sessionId: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, body.sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}
