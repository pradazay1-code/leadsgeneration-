import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const [sequences, enrollments] = await Promise.all([
      store.listSequences(),
      store.listEnrollments(),
    ]);
    return NextResponse.json({ sequences, enrollments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load sequences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
