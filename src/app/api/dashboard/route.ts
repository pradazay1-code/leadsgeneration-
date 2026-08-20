import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const [summary, pipelines] = await Promise.all([store.dashboard(), store.listPipelines()]);
    return NextResponse.json({ summary, pipelines, storeKind: store.kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
