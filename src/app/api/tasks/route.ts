import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { TASK_TYPES, type TaskPriority, type TaskType } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope");

  try {
    const store = await getStore();
    const tasks = await store.listTasks({
      // "today" means everything due by end of today, including overdue.
      dueBefore: scope === "today" ? new Date(new Date().setHours(23, 59, 59, 999)).toISOString() : undefined,
      includeCompleted: params.get("includeCompleted") === "true",
      leadId: params.get("leadId") ?? undefined,
      limit: 300,
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load tasks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A task title is required" }, { status: 400 });

  const type = TASK_TYPES.includes(body.type as TaskType) ? (body.type as TaskType) : "followup";
  const priority = ["low", "normal", "high"].includes(body.priority as string)
    ? (body.priority as TaskPriority)
    : "normal";

  try {
    const store = await getStore();
    const task = await store.createTask({
      leadId: typeof body.leadId === "string" ? body.leadId : null,
      title: title.slice(0, 200),
      notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
      type,
      priority,
      dueAt: typeof body.dueAt === "string" ? body.dueAt : null,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
