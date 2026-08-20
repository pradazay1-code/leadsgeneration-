import type { Lead, LeadFilters, LeadSort, LeadStats, NicheId, PresenceTier } from "../types";
import { LEAD_STATUSES } from "../types";
import { TIER_ORDER } from "../scoring";

function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

/** Pure predicate shared by the in-memory store and any client-side filtering. */
export function matchesFilters(lead: Lead, f: LeadFilters): boolean {
  if (f.niches?.length && !f.niches.includes(lead.niche)) return false;
  if (f.tiers?.length && !f.tiers.includes(lead.tier)) return false;
  if (f.statuses?.length && !f.statuses.includes(lead.status)) return false;
  if (f.states?.length && !(lead.state && f.states.includes(lead.state))) return false;
  if (f.cities?.length && !(lead.city && f.cities.includes(lead.city))) return false;
  if (f.sources?.length && !lead.sources.some((s) => f.sources!.includes(s))) return false;

  if (typeof f.minScore === "number" && lead.score < f.minScore) return false;
  if (typeof f.maxScore === "number" && lead.score > f.maxScore) return false;
  // Unknown review counts pass — those are the most under-the-radar leads.
  if (
    typeof f.maxReviews === "number" &&
    lead.reviewCount !== null &&
    lead.reviewCount > f.maxReviews
  ) {
    return false;
  }

  if (typeof f.hasWebsite === "boolean" && Boolean(lead.website) !== f.hasWebsite) return false;
  if (typeof f.hasPhone === "boolean" && Boolean(lead.phone) !== f.hasPhone) return false;
  if (typeof f.hasEmail === "boolean" && Boolean(lead.email) !== f.hasEmail) return false;

  if (typeof f.discoveredWithinDays === "number") {
    if (new Date(lead.discoveredAt).getTime() < daysAgo(f.discoveredWithinDays)) return false;
  }

  if (f.q) {
    const q = f.q.toLowerCase();
    const haystack = [lead.name, lead.city, lead.state, lead.address, lead.phone, lead.websiteHost, lead.notes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

/** Nulls sort as "fewest" — an unknown review count is the strongest newness hint. */
function reviewsAsc(a: Lead, b: Lead): number {
  const av = a.reviewCount ?? -1;
  const bv = b.reviewCount ?? -1;
  return av - bv || b.score - a.score;
}

const SORTERS: Record<LeadSort, (a: Lead, b: Lead) => number> = {
  score_desc: (a, b) => b.score - a.score || (a.reviewCount ?? -1) - (b.reviewCount ?? -1),
  score_asc: (a, b) => a.score - b.score,
  newest: (a, b) => Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt),
  oldest: (a, b) => Date.parse(a.discoveredAt) - Date.parse(b.discoveredAt),
  reviews_asc: reviewsAsc,
  reviews_desc: (a, b) => (b.reviewCount ?? -1) - (a.reviewCount ?? -1),
  name_asc: (a, b) => a.name.localeCompare(b.name),
};

export function sortLeads(leads: Lead[], sort: LeadSort = "score_desc"): Lead[] {
  return [...leads].sort(SORTERS[sort] ?? SORTERS.score_desc);
}

function emptyRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

export function computeStats(leads: Lead[]): LeadStats {
  const byTier = emptyRecord(TIER_ORDER as readonly PresenceTier[]);
  const byStatus = emptyRecord(LEAD_STATUSES as readonly (typeof LEAD_STATUSES)[number][]);
  const byNiche = emptyRecord(["junk_removal", "real_estate"] as const) as Record<NicheId, number>;

  const dayCutoff = daysAgo(1);
  const weekCutoff = daysAgo(7);
  let newToday = 0;
  let newThisWeek = 0;
  let untouched = 0;
  let noWebsite = 0;
  let scoreSum = 0;

  for (const l of leads) {
    byTier[l.tier] += 1;
    byStatus[l.status] += 1;
    byNiche[l.niche] += 1;

    const t = Date.parse(l.discoveredAt);
    if (t >= dayCutoff) newToday += 1;
    if (t >= weekCutoff) newThisWeek += 1;
    if (l.status === "new") untouched += 1;
    if (!l.website) noWebsite += 1;
    scoreSum += l.score;
  }

  return {
    total: leads.length,
    newToday,
    newThisWeek,
    untouched,
    noWebsite,
    byTier,
    byStatus,
    byNiche,
    avgScore: leads.length ? Math.round(scoreSum / leads.length) : 0,
  };
}
