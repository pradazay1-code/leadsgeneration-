import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isNicheId } from "@/lib/niches";
import type { NicheId, Territory } from "@/lib/types";

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

  const patch: Partial<Territory> = {};
  if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim().slice(0, 80);
  if (typeof body.area === "string" && body.area.trim()) patch.area = body.area.trim().slice(0, 120);
  if (typeof body.state === "string") patch.state = body.state.trim().toUpperCase();
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Array.isArray(body.niches)) {
    const niches = body.niches.filter((n): n is NicheId => typeof n === "string" && isNicheId(n));
    if (niches.length) patch.niches = niches;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const store = await getStore();
    const territory = await store.updateTerritory(id, patch);
    if (!territory) return NextResponse.json({ error: "Territory not found" }, { status: 404 });
    return NextResponse.json({ territory });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update territory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const store = await getStore();
    const ok = await store.deleteTerritory(id);
    if (!ok) return NextResponse.json({ error: "Territory not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete territory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
