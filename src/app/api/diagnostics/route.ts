import { NextResponse } from "next/server";
import { runDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Live health check of every moving part: database, territories, geocoder, and
 * a real test query against each configured data source.
 */
export async function GET(request: Request) {
  const area = new URL(request.url).searchParams.get("area")?.trim() || undefined;
  try {
    return NextResponse.json(await runDiagnostics(area));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Diagnostics failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
