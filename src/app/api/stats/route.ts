import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { providerStatuses } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const [stats, scans] = await Promise.all([store.stats(), store.recentScans(5)]);

    return NextResponse.json({
      stats,
      recentScans: scans,
      providers: providerStatuses(),
      storeKind: store.kind,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
