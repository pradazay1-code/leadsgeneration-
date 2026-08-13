import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = new Set(["filters", "rail"]);
const MAX_VALUE_BYTES = 20_000;

/**
 * Server-side user preferences (saved filter view, panel state) so the
 * workspace looks the same from any device — everything lives behind the
 * Vercel deployment, nothing important in one browser's localStorage.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const keys = (url.searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => ALLOWED_KEYS.has(k));

  try {
    const store = await getStore();
    const out: Record<string, unknown> = {};
    for (const key of keys.length ? keys : [...ALLOWED_KEYS]) {
      out[key] = await store.getPref(key);
    }
    return NextResponse.json({ prefs: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const entries = Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k));
  if (!entries.length) {
    return NextResponse.json(
      { error: `Nothing to save — allowed keys: ${[...ALLOWED_KEYS].join(", ")}` },
      { status: 400 },
    );
  }

  for (const [key, value] of entries) {
    if (JSON.stringify(value).length > MAX_VALUE_BYTES) {
      return NextResponse.json({ error: `Preference "${key}" is too large` }, { status: 400 });
    }
  }

  try {
    const store = await getStore();
    for (const [key, value] of entries) {
      await store.setPref(key, value);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
