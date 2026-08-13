export const SESSION_COOKIE = "leadsignal_session";
const SESSION_PAYLOAD = "leadsignal-session-v1";

/**
 * Optional single-operator gate. When `APP_PASSWORD` is set, every page and
 * API route requires a session cookie. This is deliberately not multi-user
 * auth — it exists so a public Vercel URL can't be used to drain the Places
 * budget or read the lead list.
 */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Session token = HMAC(payload, password). Only someone who knows the password
 * can mint one, and the password itself never lands in the cookie.
 *
 * Uses Web Crypto so the same code runs in middleware (edge) and route
 * handlers (node).
 */
export async function mintToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(SESSION_PAYLOAD));
  return toHex(sig);
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return true;
  if (!token) return false;
  return safeEqual(token, await mintToken(password));
}
