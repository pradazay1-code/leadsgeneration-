import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { Task } from "@/lib/crm/types";

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

  const patch: Partial<Task> = {};
  if (typeof body.title === "string") patch.title = body.title.slice(0, 200);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
  if ("dueAt" in body) patch.dueAt = typeof body.dueAt === "string" ? body.dueAt : null;
  // `done: true` completes the task now; `false` reopens it.
  if (typeof body.done === "boolean") {
    patch.completedAt = body.done ? new Date().toISOString() : null;
  }

  try {
    const store = await getStore();
    const task = await store.updateTask(id, patch);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const store = await getStore();
    const ok = await store.deleteTask(id);
    if (!ok) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
