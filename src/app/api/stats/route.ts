import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isPlacesConfigured } from "@/lib/places";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const [stats, scans, demo] = await Promise.all([
      store.stats(),
      store.recentScans(5),
      store.isDemo(),
    ]);

    return NextResponse.json({
      stats,
      recentScans: scans,
      demoData: demo,
      placesConfigured: isPlacesConfigured(),
      storeKind: store.kind,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
