import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";
import type { LeadPatch } from "@/lib/db/store";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: LeadPatch = {};

  if (typeof body.stageId === "string" || body.stageId === null) patch.stageId = body.stageId as string | null;
  if (typeof body.pipelineId === "string" || body.pipelineId === null) patch.pipelineId = body.pipelineId as string | null;
  if (typeof body.valueCents === "number" && Number.isFinite(body.valueCents)) {
    patch.valueCents = Math.max(0, Math.round(body.valueCents));
  }
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (typeof body.doNotContact === "boolean") patch.doNotContact = body.doNotContact;

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
