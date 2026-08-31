import "server-only";
import type { NicheId } from "../types";
import { QuotaExceededError, reserve } from "../quota";
import { GENERIC_WEAK_DOMAINS } from "../niches";
import {
  fetchJson,
  type SearchContext,
  type SourceProvider,
  type SourceRecord,
} from "./types";

/**
 * Web research via the Brave Search API.
 *
 * Two jobs, and the second is the more valuable one:
 *
 *  1. Discovery — surface businesses that map data misses entirely. Small
 *     junk haulers are frequently unmapped but do appear in local directories,
 *     "new business" write-ups and Facebook pages.
 *  2. Website verification — the map sources can only ever say "no website in
 *     my dataset". A web search can distinguish that from "this business
 *     genuinely has no site", which is the single heaviest scoring signal.
 *
 * The free plan is only 2,000 queries/month, so the quota cap here is
 * deliberately tight and this provider runs last.
 */
const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

const DISCOVERY_QUERIES: Record<NicheId, string[]> = {
  junk_removal: [
    '"junk removal" {area} -site:yelp.com',
    '"hauling" OR "cleanout" {area} small business',
  ],
  real_estate: [
    '"real estate agent" {area} -site:zillow.com -site:realtor.com',
  ],
};

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  profile?: { name?: string; long_name?: string };
  meta_url?: { hostname?: string };
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

function apiKey(): string | null {
  return process.env.BRAVE_API_KEY?.trim() || null;
}

/** US phone numbers as they appear in search snippets. */
const PHONE_RE = /\(?\b(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/;

/**
 * Turn a search result into a candidate business. Deliberately conservative:
 * directory and social pages become evidence about a business rather than a
 * business in their own right, so we only emit a record when the result looks
 * like a company's own page.
 */
function toRecord(
  result: BraveResult,
  niche: NicheId,
  fallbackCity: string,
  fallbackState: string,
): SourceRecord | null {
  const host = result.meta_url?.hostname?.replace(/^www\./, "");
  const title = result.title?.trim();
  if (!host || !title) return null;

  // Skip aggregators and social pages — these describe businesses, they aren't one.
  if (GENERIC_WEAK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;

  // Strip the usual SEO tail: "Acme Hauling | Junk Removal in Norwood MA".
  const name = title.split(/[|–—:]/)[0].replace(/\s*-\s*(Home|Official Site).*$/i, "").trim();
  if (name.length < 3 || name.length > 80) return null;

  const phoneMatch = `${result.description ?? ""}`.match(PHONE_RE);
  const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : null;

  return {
    source: "web",
    nativeId: `web:${host}`,
    profileUrl: result.url ?? null,
    name,
    phone,
    email: null,
    // The result IS their website, so this is a confirmed presence.
    website: result.url ?? null,
    address: null,
    city: fallbackCity || null,
    state: fallbackState || null,
    postalCode: null,
    lat: null,
    lng: null,
    rating: null,
    reviewCount: null,
    photoCount: null,
    hasHours: null,
    businessStatus: null,
    categories: [niche],
  };
}

export const webProvider: SourceProvider = {
  id: "web",
  label: "Web research",
  needsKey: true,
  needsCoordinates: false,

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  statusDetail(): string {
    if (!this.isConfigured()) {
      return "Set BRAVE_API_KEY to enable. Finds businesses that map data misses and confirms whether a website really exists. Free tier is only 2,000 queries/month, so it runs last and on a tight cap.";
    }
    return "Connected. Runs last on a tight budget — used for businesses the map sources miss, and to verify website absence.";
  },

  supportsNiche(): boolean {
    return true;
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const key = apiKey();
    if (!key) return [];

    const { territory } = ctx;
    const city = territory.area.split(",")[0]?.trim() ?? "";
    const out: SourceRecord[] = [];
    const seen = new Set<string>();

    for (const template of DISCOVERY_QUERIES[ctx.niche]) {
      if (out.length >= ctx.limit) break;

      const allowed = await reserve("brave_search");
      if (!allowed.ok) {
        throw new QuotaExceededError(allowed.reason ?? "Brave quota exhausted", "brave_search");
      }

      const url = new URL(BRAVE_URL);
      url.searchParams.set("q", template.replace("{area}", territory.area));
      url.searchParams.set("count", "20");
      url.searchParams.set("country", "us");
      url.searchParams.set("safesearch", "moderate");

      const data = await fetchJson<BraveResponse>(
        url.toString(),
        {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
          signal: ctx.signal,
          timeoutMs: 20000,
        },
        "web",
      );

      for (const result of data.web?.results ?? []) {
        const rec = toRecord(result, ctx.niche, city, territory.state);
        if (!rec || seen.has(rec.nativeId)) continue;
        seen.add(rec.nativeId);
        out.push(rec);
        if (out.length >= ctx.limit) break;
      }

      // Brave's free plan is rate-limited to roughly one query per second.
      await new Promise((r) => setTimeout(r, 1100));
    }

    return out;
  },
};

/**
 * Check whether a named business appears to have a website of its own.
 * Used to upgrade "no website in the map data" into a confirmed finding.
 * Returns null when the check couldn't run (no key or no quota).
 */
export async function verifyWebsite(
  name: string,
  city: string | null,
): Promise<{ found: boolean; url: string | null } | null> {
  const key = apiKey();
  if (!key) return null;

  const allowed = await reserve("brave_search");
  if (!allowed.ok) return null;

  const url = new URL(BRAVE_URL);
  url.searchParams.set("q", `"${name}" ${city ?? ""} official site`.trim());
  url.searchParams.set("count", "5");
  url.searchParams.set("country", "us");

  try {
    const data = await fetchJson<BraveResponse>(
      url.toString(),
      { headers: { Accept: "application/json", "X-Subscription-Token": key }, timeoutMs: 15000 },
      "web",
    );

    for (const result of data.web?.results ?? []) {
      const host = result.meta_url?.hostname?.replace(/^www\./, "");
      if (!host) continue;
      if (GENERIC_WEAK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) continue;

      // A loose name match guards against unrelated sites ranking first.
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const hostSlug = host.toLowerCase().replace(/[^a-z0-9]/g, "");
      const firstWord = slug.slice(0, 6);
      if (firstWord && hostSlug.includes(firstWord)) {
        return { found: true, url: result.url ?? null };
      }
    }
    return { found: false, url: null };
  } catch {
    return null;
  }
}
