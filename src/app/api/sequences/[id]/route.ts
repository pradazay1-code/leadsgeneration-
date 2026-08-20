import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { SequenceChannel, SequenceStep } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

const CHANNELS: SequenceChannel[] = ["call", "email", "sms", "manual"];

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

  try {
    const store = await getStore();

    if (Array.isArray(body.steps)) {
      const steps: Array<Omit<SequenceStep, "id" | "sequenceId">> = body.steps
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .map((s, i) => ({
          position: i,
          dayOffset: typeof s.dayOffset === "number" ? Math.max(0, Math.round(s.dayOffset)) : 0,
          channel: CHANNELS.includes(s.channel as SequenceChannel)
            ? (s.channel as SequenceChannel)
            : "call",
          subject: typeof s.subject === "string" ? s.subject.slice(0, 300) : "",
          body: typeof s.body === "string" ? s.body.slice(0, 4000) : "",
        }));
      await store.replaceSequenceSteps(id, steps);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
    if (typeof body.description === "string") patch.description = body.description.slice(0, 500);
    if (typeof body.active === "boolean") patch.active = body.active;

    const sequence = Object.keys(patch).length
      ? await store.updateSequence(id, patch)
      : (await store.listSequences()).find((s) => s.id === id) ?? null;

    if (!sequence) return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    return NextResponse.json({ sequence });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update sequence";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const store = await getStore();
    const ok = await store.deleteSequence(id);
    if (!ok) return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete sequence";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
