import "server-only";
import type { NicheId } from "../types";
import {
  fetchJson,
  type SearchContext,
  type SourceProvider,
  type SourceRecord,
} from "./types";

/**
 * Yelp Fusion API (official) — https://api.yelp.com/v3/businesses/search.
 *
 * Yelp retired its free tier: new keys get a 30-day trial (5,000 calls), then
 * it's pay-per-call. The provider is therefore optional — set YELP_API_KEY to
 * enable it. It's the main source of review counts, which is the best public
 * "how new is this business" proxy, so it's worth the trial for a burst of
 * territory scans even if you never pay.
 *
 * Note: Yelp's API never exposes a business's own website, so a Yelp-only
 * lead can't confirm "no website" — the scorer treats that honestly.
 */
const SEARCH_URL = "https://api.yelp.com/v3/businesses/search";

const CATEGORIES_BY_NICHE: Record<NicheId, { categories: string; term: string }> = {
  junk_removal: { categories: "junkremovalandhauling,dumpsterrental", term: "junk removal" },
  real_estate: { categories: "realestateagents,realestatesvcs,propertymgmt", term: "real estate agent" },
};

interface YelpBusiness {
  id?: string;
  name?: string;
  url?: string;
  phone?: string;
  display_phone?: string;
  review_count?: number;
  rating?: number;
  is_closed?: boolean;
  categories?: Array<{ alias?: string; title?: string }>;
  coordinates?: { latitude?: number; longitude?: number };
  location?: {
    address1?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    display_address?: string[];
  };
}

interface YelpSearchResponse {
  businesses?: YelpBusiness[];
  total?: number;
}

function apiKey(): string | null {
  return process.env.YELP_API_KEY?.trim() || null;
}

/** Strip Yelp's tracking query string from the listing URL. */
function cleanUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

const NICHE_CATEGORY_MAP: Record<string, string> = {
  junkremovalandhauling: "junk_removal",
  dumpsterrental: "dumpster_rental",
  realestateagents: "real_estate_agency",
  realestatesvcs: "real_estate_agency",
  propertymgmt: "real_estate_agency",
  realestate: "real_estate_agency",
};

export const yelpProvider: SourceProvider = {
  id: "yelp",
  label: "Yelp",
  needsKey: true,

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  statusDetail(): string {
    if (!this.isConfigured()) {
      return "Good second source. Yelp offers a 30-day trial (5,000 calls), then pay-per-call. Strong coverage of these niches plus review counts. Set YELP_API_KEY and redeploy.";
    }
    return "Connected. Supplies review counts — the strongest public signal of how new a business is.";
  },

  supportsNiche(): boolean {
    return true;
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const key = apiKey();
    if (!key) return [];

    const { categories, term } = CATEGORIES_BY_NICHE[ctx.niche];
    const out: SourceRecord[] = [];
    const pageSize = 50;

    for (let offset = 0; offset < Math.min(ctx.limit, 200); offset += pageSize) {
      const url = new URL(SEARCH_URL);
      url.searchParams.set("location", ctx.territory.area);
      url.searchParams.set("term", term);
      url.searchParams.set("categories", categories);
      url.searchParams.set("limit", String(Math.min(pageSize, ctx.limit - offset)));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("radius", String(Math.min(Math.round(ctx.territory.radiusKm * 1000), 40000)));
      url.searchParams.set("sort_by", "best_match");

      const data = await fetchJson<YelpSearchResponse>(
        url.toString(),
        { headers: { Authorization: `Bearer ${key}` }, signal: ctx.signal },
        "yelp",
      );

      const businesses = data.businesses ?? [];
      for (const b of businesses) {
        if (!b.id || !b.name) continue;
        out.push({
          source: "yelp",
          nativeId: b.id,
          profileUrl: cleanUrl(b.url),
          name: b.name,
          phone: b.display_phone?.trim() || b.phone?.trim() || null,
          // Yelp's API never exposes business emails.
          email: null,
          // Yelp's API does not expose business websites.
          website: null,
          address: b.location?.display_address?.join(", ") ?? b.location?.address1 ?? null,
          city: b.location?.city ?? null,
          state: b.location?.state ?? (ctx.territory.state || null),
          postalCode: b.location?.zip_code ?? null,
          lat: b.coordinates?.latitude ?? null,
          lng: b.coordinates?.longitude ?? null,
          rating: typeof b.rating === "number" ? b.rating : null,
          reviewCount: typeof b.review_count === "number" ? b.review_count : 0,
          photoCount: null,
          hasHours: null,
          businessStatus: b.is_closed ? "CLOSED" : null,
          categories: (b.categories ?? [])
            .map((c) => (c.alias && NICHE_CATEGORY_MAP[c.alias]) || c.alias || "")
            .filter(Boolean),
        });
      }

      // Stop when the page came back short — no more results.
      if (businesses.length < pageSize) break;
    }

    return out.slice(0, ctx.limit);
  },
};
