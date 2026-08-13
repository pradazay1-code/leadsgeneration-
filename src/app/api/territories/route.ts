import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isNicheId } from "@/lib/niches";
import type { NicheId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    return NextResponse.json({ territories: await store.listTerritories() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load territories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { label?: unknown; area?: unknown; state?: unknown; niches?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const area = typeof body.area === "string" ? body.area.trim() : "";
  if (!area) {
    return NextResponse.json({ error: "An area is required, e.g. “Norwood, MA”" }, { status: 400 });
  }

  const niches = Array.isArray(body.niches)
    ? (body.niches.filter((n): n is NicheId => typeof n === "string" && isNicheId(n)) as NicheId[])
    : [];
  if (!niches.length) {
    return NextResponse.json({ error: "Pick at least one niche to track" }, { status: 400 });
  }

  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : area;
  // Best-effort state extraction from a "City, ST" style area string.
  const inferredState = area.match(/,\s*([A-Za-z]{2})\s*$/)?.[1]?.toUpperCase() ?? "";
  const state = typeof body.state === "string" && body.state.trim() ? body.state.trim().toUpperCase() : inferredState;

  const radiusRaw = Number((body as { radiusKm?: unknown }).radiusKm);
  const radiusKm = Number.isFinite(radiusRaw) ? Math.min(Math.max(Math.round(radiusRaw), 2), 50) : 15;

  try {
    const store = await getStore();
    const territory = await store.createTerritory({
      label: label.slice(0, 80),
      area: area.slice(0, 120),
      state,
      niches,
      radiusKm,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
    return NextResponse.json({ territory }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create territory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
