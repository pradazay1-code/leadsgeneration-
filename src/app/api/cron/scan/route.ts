import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily sweep, wired up in vercel.json.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that env var is
 * set. We require it in production so a public deployment cannot have its
 * Places budget drained by anyone who guesses the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — refusing to run an unauthenticated scan." },
      { status: 503 },
    );
  }

  try {
    const summary = await runScan();
    console.log("[leadsignal] cron scan", JSON.stringify(summary));
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    console.error("[leadsignal] cron scan failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
