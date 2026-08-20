import { TIER_ORDER } from "./scoring";
import { isNicheId } from "./niches";
import {
  LEAD_STATUSES,
  type LeadFilters,
  type LeadSort,
  type LeadStatus,
  type NicheId,
  type PresenceTier,
  type SourceId,
} from "./types";

const SOURCE_IDS: SourceId[] = ["bizdata", "osm", "geoapify", "yelp", "google_places", "manual"];

const SORTS: LeadSort[] = [
  "score_desc",
  "score_asc",
  "newest",
  "oldest",
  "reviews_asc",
  "reviews_desc",
  "name_asc",
];

/** Read a repeatable param supplied either as `?k=a&k=b` or `?k=a,b`. */
function multi(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

function num(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function bool(params: URLSearchParams, key: string): boolean | undefined {
  const raw = params.get(key);
  if (raw === null || raw === "" || raw === "any") return undefined;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return undefined;
}

/** Parse and validate the lead filter set from a URL query string. */
export function parseLeadFilters(params: URLSearchParams): LeadFilters {
  const niches = multi(params, "niche").filter(isNicheId) as NicheId[];
  const tiers = multi(params, "tier").filter((t): t is PresenceTier =>
    (TIER_ORDER as string[]).includes(t),
  );
  const statuses = multi(params, "status").filter((s): s is LeadStatus =>
    (LEAD_STATUSES as string[]).includes(s),
  );
  const sources = multi(params, "source").filter((s): s is SourceId =>
    (SOURCE_IDS as string[]).includes(s),
  );

  const sortRaw = params.get("sort");
  const sort = sortRaw && (SORTS as string[]).includes(sortRaw) ? (sortRaw as LeadSort) : "score_desc";

  const limit = num(params, "limit");
  const offset = num(params, "offset");

  return {
    q: params.get("q")?.trim() || undefined,
    niches: niches.length ? niches : undefined,
    tiers: tiers.length ? tiers : undefined,
    statuses: statuses.length ? statuses : undefined,
    sources: sources.length ? sources : undefined,
    states: multi(params, "state").length ? multi(params, "state") : undefined,
    cities: multi(params, "city").length ? multi(params, "city") : undefined,
    minScore: num(params, "minScore"),
    maxScore: num(params, "maxScore"),
    maxReviews: num(params, "maxReviews"),
    hasWebsite: bool(params, "hasWebsite"),
    hasPhone: bool(params, "hasPhone"),
    discoveredWithinDays: num(params, "withinDays"),
    sort,
    limit: limit === undefined ? 200 : Math.min(Math.max(limit, 1), 500),
    offset: offset === undefined ? 0 : Math.max(offset, 0),
  };
}

/** Serialise filters back into a query string for links and the CSV export. */
export function filtersToParams(f: LeadFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  f.niches?.forEach((v) => p.append("niche", v));
  f.tiers?.forEach((v) => p.append("tier", v));
  f.statuses?.forEach((v) => p.append("status", v));
  f.sources?.forEach((v) => p.append("source", v));
  f.states?.forEach((v) => p.append("state", v));
  f.cities?.forEach((v) => p.append("city", v));
  if (typeof f.minScore === "number") p.set("minScore", String(f.minScore));
  if (typeof f.maxScore === "number") p.set("maxScore", String(f.maxScore));
  if (typeof f.maxReviews === "number") p.set("maxReviews", String(f.maxReviews));
  if (typeof f.hasWebsite === "boolean") p.set("hasWebsite", String(f.hasWebsite));
  if (typeof f.hasPhone === "boolean") p.set("hasPhone", String(f.hasPhone));
  if (typeof f.discoveredWithinDays === "number") p.set("withinDays", String(f.discoveredWithinDays));
  if (f.sort) p.set("sort", f.sort);
  return p;
}
