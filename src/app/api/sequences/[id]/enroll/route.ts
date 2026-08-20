import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Enrol one or more leads into a sequence. */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;

  let body: { leadIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds.filter((v): v is string => typeof v === "string")
    : [];
  if (!leadIds.length) {
    return NextResponse.json({ error: "leadIds is required" }, { status: 400 });
  }

  try {
    const store = await getStore();
    const enrollments = [];
    for (const leadId of leadIds) {
      enrollments.push(await store.enrollLead(id, leadId));
    }
    return NextResponse.json({ enrollments }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrol";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
