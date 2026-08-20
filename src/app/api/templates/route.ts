import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    return NextResponse.json({ templates: await store.listTemplates() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load templates";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
