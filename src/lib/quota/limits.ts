import type { SourceId } from "../types";

/**
 * Anything that consumes a metered API. Wider than SourceId because the
 * geocoder and the web-research provider are billed separately from the
 * place-search providers even when they share a vendor.
 */
export type QuotaKey =
  | "mapbox_search"
  | "mapbox_geocode"
  | "brave_search"
  | "firecrawl_search"
  | "firecrawl_scrape"
  | "geoapify_places"
  | "geoapify_geocode"
  | "yelp"
  | "overpass"
  | "nominatim"
  | "bizdata";

export interface QuotaLimit {
  key: QuotaKey;
  label: string;
  /** What the vendor's free tier actually allows. Documented, not enforced. */
  freeTier: { monthly?: number; daily?: number; note: string };
  /**
   * What this app will actually allow. Deliberately set below the free tier so
   * a burst near the end of a period can't tip over into paid usage.
   */
  cap: { monthly?: number; daily?: number };
  /** Env var that overrides the monthly cap. */
  envMonthly?: string;
  envDaily?: string;
}

/**
 * Caps sit at roughly 80% of each vendor's documented free allowance. The
 * margin exists because usage is counted by this app, and a request that fails
 * after the vendor counted it would otherwise drift the two tallies apart.
 *
 * Every number here is a *hard stop*: when a cap is hit the provider is skipped
 * for the rest of the period rather than being allowed to spill into billing.
 */
export const QUOTA_LIMITS: Record<QuotaKey, QuotaLimit> = {
  mapbox_search: {
    key: "mapbox_search",
    label: "Mapbox Search Box",
    freeTier: {
      monthly: 25_000,
      note: "25,000 requests/month on the permanent free tier for per-request endpoints (/forward, /category).",
    },
    cap: { monthly: 20_000, daily: 800 },
    envMonthly: "MAPBOX_SEARCH_MONTHLY_CAP",
    envDaily: "MAPBOX_SEARCH_DAILY_CAP",
  },
  mapbox_geocode: {
    key: "mapbox_geocode",
    label: "Mapbox Geocoding",
    freeTier: {
      monthly: 100_000,
      note: "100,000 temporary-geocode requests/month free.",
    },
    cap: { monthly: 50_000, daily: 2_000 },
    envMonthly: "MAPBOX_GEOCODE_MONTHLY_CAP",
  },
  brave_search: {
    key: "brave_search",
    label: "Brave Search",
    freeTier: {
      monthly: 2_000,
      note: "2,000 queries/month on the free plan, rate-limited to about one query per second.",
    },
    // Low cap: this is the scarcest budget, so it's reserved for enrichment
    // rather than being spent on bulk discovery.
    cap: { monthly: 1_500, daily: 60 },
    envMonthly: "BRAVE_MONTHLY_CAP",
    envDaily: "BRAVE_DAILY_CAP",
  },
  firecrawl_search: {
    key: "firecrawl_search",
    label: "Firecrawl search",
    freeTier: {
      monthly: 500,
      note: "Firecrawl bills in credits, not calls. A search costs about 1 credit per 10 results; the free allowance is 500 credits one-time, and paid plans start at 3,000/month.",
    },
    // Search and scrape draw on ONE credit pool, so their two caps are sized
    // to sum to the free allowance rather than each fitting inside it
    // separately. Raise both via env vars if you're on a paid plan.
    cap: { monthly: 200, daily: 20 },
    envMonthly: "FIRECRAWL_SEARCH_MONTHLY_CAP",
    envDaily: "FIRECRAWL_SEARCH_DAILY_CAP",
  },
  firecrawl_scrape: {
    key: "firecrawl_scrape",
    label: "Firecrawl scrape + extract",
    freeTier: {
      monthly: 500,
      note: "Shares the same credit pool as search. A plain scrape is ~1 credit; structured JSON extraction costs about 5, because an LLM reads the page.",
    },
    // Counted in credits rather than calls — the provider reserves 5 per
    // extraction, so this number is a credit budget, not a request budget.
    // 300 credits is roughly 60 enriched pages a month on the free plan.
    cap: { monthly: 300, daily: 40 },
    envMonthly: "FIRECRAWL_SCRAPE_MONTHLY_CAP",
    envDaily: "FIRECRAWL_SCRAPE_DAILY_CAP",
  },
  geoapify_places: {
    key: "geoapify_places",
    label: "Geoapify Places",
    freeTier: { daily: 3_000, note: "3,000 credits/day free." },
    cap: { daily: 2_000 },
    envDaily: "GEOAPIFY_DAILY_CAP",
  },
  geoapify_geocode: {
    key: "geoapify_geocode",
    label: "Geoapify Geocoding",
    freeTier: { daily: 3_000, note: "Shares the same 3,000/day credit pool." },
    cap: { daily: 500 },
  },
  yelp: {
    key: "yelp",
    label: "Yelp Fusion",
    freeTier: { monthly: 0, note: "Trial only — 5,000 calls over 30 days, then pay-per-call." },
    // Zero by default: Yelp bills after the trial, so it stays off unless the
    // cap is raised deliberately.
    cap: { monthly: 0, daily: 0 },
    envMonthly: "YELP_MONTHLY_CAP",
    envDaily: "YELP_DAILY_CAP",
  },
  overpass: {
    key: "overpass",
    label: "OpenStreetMap Overpass",
    freeTier: { daily: 10_000, note: "Free public instance, but heavily rate-limited. Be polite." },
    cap: { daily: 200 },
    envDaily: "OVERPASS_DAILY_CAP",
  },
  nominatim: {
    key: "nominatim",
    label: "Nominatim Geocoding",
    freeTier: { daily: 1_000, note: "Free, max 1 request/second, blocks cloud hosts often." },
    cap: { daily: 200 },
  },
  bizdata: {
    key: "bizdata",
    label: "BizData",
    freeTier: { daily: 1_000, note: "Free community API, no published quota. Treated conservatively." },
    cap: { daily: 300 },
  },
};

/** Which quota a place-search provider spends from. */
export const QUOTA_FOR_SOURCE: Partial<Record<SourceId, QuotaKey>> = {
  mapbox: "mapbox_search",
  geoapify: "geoapify_places",
  yelp: "yelp",
  osm: "overpass",
  bizdata: "bizdata",
  web: "brave_search",
  firecrawl: "firecrawl_search",
};

function envInt(name: string | undefined): number | undefined {
  if (!name) return undefined;
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Effective caps, after env overrides. */
export function effectiveCap(key: QuotaKey): { monthly?: number; daily?: number } {
  const limit = QUOTA_LIMITS[key];
  return {
    monthly: envInt(limit.envMonthly) ?? limit.cap.monthly,
    daily: envInt(limit.envDaily) ?? limit.cap.daily,
  };
}

/** Period keys used by the counter table. */
export function currentPeriods(now = new Date()): { month: string; day: string } {
  const iso = now.toISOString();
  return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
}

export interface QuotaDecision {
  ok: boolean;
  reason?: string;
}

/**
 * The cap check itself, with no I/O. Kept pure and separate so the rule that
 * actually protects the user's bill can be tested directly.
 *
 * `count` is added *before* comparing, so a call is refused when it would take
 * usage past the cap rather than when usage has already passed it.
 */
export function evaluateQuota(
  key: QuotaKey,
  usage: { monthly: number; daily: number },
  cap: { monthly?: number; daily?: number },
  count = 1,
): QuotaDecision {
  const label = QUOTA_LIMITS[key].label;

  if (cap.monthly !== undefined && usage.monthly + count > cap.monthly) {
    return {
      ok: false,
      reason:
        cap.monthly === 0
          ? `${label} is disabled (cap set to 0).`
          : `${label} monthly cap reached (${usage.monthly}/${cap.monthly}). Resets on the 1st.`,
    };
  }
  if (cap.daily !== undefined && usage.daily + count > cap.daily) {
    return {
      ok: false,
      reason: `${label} daily cap reached (${usage.daily}/${cap.daily}). Resets at midnight UTC.`,
    };
  }
  return { ok: true };
}

/**
 * The minimum a store has to provide for quota accounting. Narrower than the
 * full Store interface so the reservation logic can run against a plain object
 * in tests as well as against Postgres in production.
 */
export interface UsageCounter {
  getUsage(key: QuotaKey, periodType: "month" | "day", period: string): Promise<number>;
  incrementUsage(key: QuotaKey, count: number): Promise<void>;
}

/**
 * Reserve budget against a counter: read, decide, and only then increment.
 *
 * The increment happens before the HTTP request is made, which is the point —
 * if the request is what incremented the counter, concurrent scans would each
 * read the same pre-call total and collectively blow through the cap.
 */
export async function reserveWith(
  counter: UsageCounter,
  key: QuotaKey,
  count = 1,
  now = new Date(),
): Promise<QuotaDecision> {
  const cap = effectiveCap(key);
  const { month, day } = currentPeriods(now);

  const [monthly, daily] = await Promise.all([
    counter.getUsage(key, "month", month),
    counter.getUsage(key, "day", day),
  ]);

  const decision = evaluateQuota(key, { monthly, daily }, cap, count);
  if (!decision.ok) return decision;

  await counter.incrementUsage(key, count);
  return { ok: true };
}
