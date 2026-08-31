import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, verifyToken } from "@/lib/auth";

/**
 * Paths that must stay reachable without a session: the login screen itself,
 * the login endpoint, the cron route (which carries its own bearer secret from
 * Vercel Cron rather than a browser cookie), and the version endpoint.
 *
 * /api/version is public on purpose. "Which build is live?" has to be
 * answerable when the app is misbehaving, and a password gate that hides the
 * answer turns a two-second check into an afternoon. It exposes a commit SHA
 * and a branch name — nothing an attacker gains from.
 */
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/cron", "/api/version"];

export async function middleware(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (await verifyToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next's own static output and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
