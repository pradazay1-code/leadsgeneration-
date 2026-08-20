import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isNicheId } from "@/lib/niches";
import type { NicheId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    return NextResponse.json({ pipelines: await store.listPipelines() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load pipelines";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { name?: unknown; niche?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A pipeline name is required" }, { status: 400 });

  const niche =
    typeof body.niche === "string" && isNicheId(body.niche) ? (body.niche as NicheId) : null;

  try {
    const store = await getStore();
    return NextResponse.json({ pipeline: await store.createPipeline(name.slice(0, 60), niche) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create pipeline";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
