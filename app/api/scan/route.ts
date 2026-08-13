// On-demand JSON scan results — useful for debugging or wiring up other clients.
import { NextResponse } from "next/server";
import { runScan } from "@/lib/scanner";

export const maxDuration = 60;
export const revalidate = 900;

export async function GET() {
  try {
    const result = await runScan();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
