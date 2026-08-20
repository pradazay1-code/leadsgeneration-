import { NextResponse } from "next/server";
import { runSequences } from "@/lib/crm/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual "run due steps now" from the Sequences page. Separate from the cron
 * route because that one is unauthenticated by nature and guards itself with
 * CRON_SECRET; this one sits behind the app's own gate like every other route.
 */
export async function POST() {
  try {
    const result = await runSequences();
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sequence run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
