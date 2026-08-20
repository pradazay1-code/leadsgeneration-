import { NextResponse } from "next/server";
import { runSequences } from "@/lib/crm/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Advances every due sequence step. Wired to run a few times a day in
 * vercel.json so deferred sends (outside business hours) get picked up.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — refusing to run outreach unauthenticated." },
      { status: 503 },
    );
  }

  try {
    const result = await runSequences();
    console.log("[leadsignal] sequence run", JSON.stringify(result));
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sequence run failed";
    console.error("[leadsignal] sequence run failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
