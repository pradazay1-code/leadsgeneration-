import { getStore } from "@/lib/db";
import { NICHES } from "@/lib/niches";
import { parseLeadFilters } from "@/lib/query";
import { TIER_META } from "@/lib/scoring";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const COLUMNS: Array<{ header: string; value: (l: Lead) => string }> = [
  { header: "Business", value: (l) => l.name },
  { header: "Niche", value: (l) => NICHES[l.niche].shortLabel },
  { header: "Score", value: (l) => String(l.score) },
  { header: "Presence", value: (l) => TIER_META[l.tier].label },
  { header: "Phone", value: (l) => l.phone ?? "" },
  { header: "Website", value: (l) => l.website ?? "" },
  { header: "City", value: (l) => l.city ?? "" },
  { header: "State", value: (l) => l.state ?? "" },
  { header: "Address", value: (l) => l.address ?? "" },
  { header: "Rating", value: (l) => (l.rating === null ? "" : l.rating.toFixed(1)) },
  { header: "Reviews", value: (l) => String(l.reviewCount) },
  { header: "Status", value: (l) => l.status },
  { header: "Notes", value: (l) => l.notes },
  { header: "Why it scored", value: (l) => l.signals.map((s) => s.label).join(" | ") },
  { header: "Discovered", value: (l) => l.discoveredAt.slice(0, 10) },
  { header: "Google Maps", value: (l) => l.mapsUrl ?? "" },
];

/**
 * Escape a CSV field. The leading-character guard stops spreadsheet apps from
 * evaluating a business name like "=cmd" as a formula.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = parseLeadFilters(url.searchParams);
  filters.limit = 5000;
  filters.offset = 0;

  const store = await getStore();
  const { rows } = await store.listLeads(filters);

  const lines = [
    COLUMNS.map((c) => csvCell(c.header)).join(","),
    ...rows.map((l) => COLUMNS.map((c) => csvCell(c.value(l))).join(",")),
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  // UTF-8 BOM so Excel reads accented business names correctly.
  return new Response(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
