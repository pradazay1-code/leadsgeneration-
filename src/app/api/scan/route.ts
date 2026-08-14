import { NextResponse } from "next/server";
import { isNicheId } from "@/lib/niches";
import { runScan } from "@/lib/scan";
import type { NicheId } from "@/lib/types";

export const dynamic = "force-dynamic";
// Places pagination across several territories can take a while.
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "scan everything with the defaults".
  }

  const territoryIds = Array.isArray(body.territoryIds)
    ? body.territoryIds.filter((v): v is string => typeof v === "string")
    : undefined;

  const niches = Array.isArray(body.niches)
    ? (body.niches.filter((n): n is NicheId => typeof n === "string" && isNicheId(n)) as NicheId[])
    : undefined;

  const minScore = typeof body.minScore === "number" ? body.minScore : undefined;

  try {
    const summary = await runScan({ territoryIds, niches, minScore });
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
