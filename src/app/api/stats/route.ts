import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { providerStatuses } from "@/lib/sources";
import { senderStatuses } from "@/lib/outreach/providers";
import { allQuotas } from "@/lib/quota";
import { buildInfo } from "@/lib/build-info";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const [stats, scans, quotas, territories] = await Promise.all([
      store.stats(),
      store.recentScans(5),
      allQuotas(),
      store.listTerritories(),
    ]);

    return NextResponse.json({
      stats,
      recentScans: scans,
      providers: providerStatuses(),
      senders: senderStatuses(),
      quotas,
      storeKind: store.kind,
      build: buildInfo(),
      // Counted so the empty state can name the actual next step rather than
      // saying "finish setup" and leaving you to guess which part.
      territories: {
        total: territories.length,
        enabled: territories.filter((t) => t.enabled).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
