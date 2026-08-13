import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;

  let body: { status?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: { status?: LeadStatus; notes?: string } = {};

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !(LEAD_STATUSES as string[]).includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${LEAD_STATUSES.join(", ")}` }, { status: 400 });
    }
    patch.status = body.status as LeadStatus;
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
    }
    patch.notes = body.notes.slice(0, 5000);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const store = await getStore();
    const lead = await store.patchLead(id, patch);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    return NextResponse.json({ lead });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update lead";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const store = await getStore();
    const ok = await store.deleteLead(id);
    if (!ok) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete lead";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
