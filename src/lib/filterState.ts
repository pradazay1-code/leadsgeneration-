import type { LeadSort, LeadStatus, NicheId, PresenceTier, SourceId } from "./types";

export interface FilterState {
  q: string;
  niches: NicheId[];
  tiers: PresenceTier[];
  statuses: LeadStatus[];
  sources: SourceId[];
  states: string[];
  cities: string[];
  minScore: number;
  /** null = no cap. */
  maxReviews: number | null;
  /** null = don't care. */
  hasWebsite: boolean | null;
  hasPhone: boolean | null;
  withinDays: number | null;
  sort: LeadSort;
}

/**
 * The default view encodes the whole point of the tool: show newer, thinner
 * operators and hide anyone who already dominates their town.
 */
export const DEFAULT_FILTERS: FilterState = {
  q: "",
  niches: [],
  tiers: ["none", "minimal", "weak"],
  statuses: [],
  sources: [],
  states: [],
  cities: [],
  minScore: 35,
  maxReviews: null,
  hasWebsite: null,
  hasPhone: null,
  withinDays: null,
  sort: "score_desc",
};

export function toQuery(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  f.niches.forEach((v) => p.append("niche", v));
  f.tiers.forEach((v) => p.append("tier", v));
  f.statuses.forEach((v) => p.append("status", v));
  f.sources.forEach((v) => p.append("source", v));
  f.states.forEach((v) => p.append("state", v));
  f.cities.forEach((v) => p.append("city", v));
  if (f.minScore > 0) p.set("minScore", String(f.minScore));
  if (f.maxReviews !== null) p.set("maxReviews", String(f.maxReviews));
  if (f.hasWebsite !== null) p.set("hasWebsite", String(f.hasWebsite));
  if (f.hasPhone !== null) p.set("hasPhone", String(f.hasPhone));
  if (f.withinDays !== null) p.set("withinDays", String(f.withinDays));
  p.set("sort", f.sort);
  return p;
}

/** How many filters differ from the default view — drives the "clear" badge. */
export function countActive(f: FilterState): number {
  let n = 0;
  if (f.q.trim()) n += 1;
  if (f.niches.length) n += 1;
  if (
    f.tiers.length !== DEFAULT_FILTERS.tiers.length ||
    !DEFAULT_FILTERS.tiers.every((t) => f.tiers.includes(t))
  ) {
    n += 1;
  }
  if (f.statuses.length) n += 1;
  if (f.sources.length) n += 1;
  if (f.states.length) n += 1;
  if (f.cities.length) n += 1;
  if (f.minScore !== DEFAULT_FILTERS.minScore) n += 1;
  if (f.maxReviews !== null) n += 1;
  if (f.hasWebsite !== null) n += 1;
  if (f.hasPhone !== null) n += 1;
  if (f.withinDays !== null) n += 1;
  return n;
}

/** Merge a stored blob over the defaults so old shapes can't break the UI. */
export function hydrateFilters(raw: unknown): FilterState {
  if (!raw || typeof raw !== "object") return DEFAULT_FILTERS;
  return { ...DEFAULT_FILTERS, ...(raw as Partial<FilterState>) };
}

const STORAGE_KEY = "leadsignal.filters.v2";

/**
 * localStorage is only an instant-paint cache; the server copy (via
 * /api/prefs) is the source of truth so the same view follows the user to any
 * device.
 */
export function loadCachedFilters(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return hydrateFilters(JSON.parse(raw));
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function cacheFilters(f: FilterState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Private-mode storage failures are not worth surfacing.
  }
}
