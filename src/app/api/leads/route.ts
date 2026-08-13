import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { parseLeadFilters } from "@/lib/query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = parseLeadFilters(url.searchParams);

  try {
    const store = await getStore();
    const [page, facets] = await Promise.all([store.listLeads(filters), store.facets()]);
    return NextResponse.json({
      rows: page.rows,
      total: page.total,
      facets,
      storeKind: store.kind,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
