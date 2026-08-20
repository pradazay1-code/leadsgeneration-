import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { CALL_OUTCOMES, type ActivityType, type CallOutcome } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

const LOGGABLE: ActivityType[] = ["note", "call", "email", "sms", "meeting"];

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const store = await getStore();
    return NextResponse.json({ activities: await store.listActivities(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Log a note, call, email, SMS or meeting against a lead. */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body.type as ActivityType;
  if (!LOGGABLE.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${LOGGABLE.join(", ")}` }, { status: 400 });
  }

  const outcome =
    typeof body.outcome === "string" && (CALL_OUTCOMES as string[]).includes(body.outcome)
      ? (body.outcome as CallOutcome)
      : null;

  try {
    const store = await getStore();
    if (!(await store.getLead(id))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const activity = await store.logActivity({
      leadId: id,
      type,
      body: typeof body.body === "string" ? body.body.slice(0, 5000) : "",
      outcome,
      meta: {},
      actor: "me",
      durationMinutes:
        typeof body.durationMinutes === "number" ? Math.round(body.durationMinutes) : null,
    });
    return NextResponse.json({ activity }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to log activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
