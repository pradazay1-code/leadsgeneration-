import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { providerStatuses } from "@/lib/sources";
import { senderStatuses } from "@/lib/outreach/providers";
import { allQuotas } from "@/lib/quota";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const [stats, scans, quotas] = await Promise.all([
      store.stats(),
      store.recentScans(5),
      allQuotas(),
    ]);

    return NextResponse.json({
      stats,
      recentScans: scans,
      providers: providerStatuses(),
      senders: senderStatuses(),
      quotas,
      storeKind: store.kind,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
