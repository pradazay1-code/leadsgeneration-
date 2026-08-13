import "server-only";
import type { NicheId } from "../types";
import {
  fetchJson,
  type SearchContext,
  type SourceProvider,
  type SourceRecord,
} from "./types";

/**
 * BizData — a free, keyless business-data API built on OpenStreetMap
 * (https://bizdata-web.vercel.app). One GET per territory×niche:
 *
 *   /api/businesses?location=Norwood, MA&category=real_estate&radius_km=15&limit=200
 *
 * Response: { total, location_resolved, businesses: [{ name, category,
 * address, phone, website, email, lat, lon, opening_hours, ... }] }
 *
 * It exposes a fixed category list (37 categories). `real_estate` exists;
 * junk removal has no category, so this provider only serves the real-estate
 * niche — the OSM Overpass provider covers junk removal on the same data.
 */
const DEFAULT_BASE = "https://bizdata-web.vercel.app";

const CATEGORY_BY_NICHE: Partial<Record<NicheId, string>> = {
  real_estate: "real_estate",
};

interface BizDataBusiness {
  name?: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  email?: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  opening_hours?: string;
  osm_id?: number | string;
  id?: number | string;
}

interface BizDataResponse {
  total?: number;
  location_resolved?: string;
  businesses?: BizDataBusiness[];
}

function baseUrl(): string {
  return (process.env.BIZDATA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

/** Pull "Norwood" / "MA" / zip out of a single-line OSM-style address. */
function parseAddress(address: string | undefined, fallbackState: string) {
  if (!address) return { city: null, state: fallbackState || null, postalCode: null };
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  const stateMatch = address.match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/);

  // Walk from the end: the city is the last comma part that still has text
  // once state abbreviations and zips are stripped ("MA 02062" strips to
  // nothing, "Norwood" survives). The first part is the street, so skip it
  // unless it's all we have.
  let city: string | null = null;
  for (let i = parts.length - 1; i >= (parts.length > 1 ? 1 : 0); i -= 1) {
    const remainder = parts[i].replace(/\b[A-Z]{2}\b|\d{5}(-\d{4})?/g, "").trim();
    if (remainder) {
      city = remainder;
      break;
    }
  }

  return {
    city,
    state: stateMatch?.[1] ?? (fallbackState || null),
    postalCode: zip,
  };
}

export const bizdataProvider: SourceProvider = {
  id: "bizdata",
  label: "BizData",
  needsKey: false,

  isConfigured(): boolean {
    return process.env.BIZDATA_DISABLED !== "1";
  },

  statusDetail(): string {
    if (!this.isConfigured()) return "Disabled via BIZDATA_DISABLED=1.";
    return "Free OpenStreetMap-backed business API — no key needed. Covers the real-estate niche.";
  },

  supportsNiche(niche: NicheId): boolean {
    return Boolean(CATEGORY_BY_NICHE[niche]);
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const category = CATEGORY_BY_NICHE[ctx.niche];
    if (!category) return [];

    const url = new URL(`${baseUrl()}/api/businesses`);
    url.searchParams.set("location", ctx.territory.area);
    url.searchParams.set("category", category);
    url.searchParams.set("radius_km", String(ctx.territory.radiusKm));
    url.searchParams.set("limit", String(Math.min(ctx.limit, 500)));

    const data = await fetchJson<BizDataResponse>(
      url.toString(),
      { signal: ctx.signal, timeoutMs: 30000 },
      "bizdata",
    );

    const out: SourceRecord[] = [];
    for (const b of data.businesses ?? []) {
      if (!b.name) continue;
      const lat = b.lat ?? b.latitude ?? null;
      const lng = b.lon ?? b.longitude ?? null;
      const nativeId = String(b.osm_id ?? b.id ?? `${b.name}|${lat}|${lng}`);
      const { city, state, postalCode } = parseAddress(b.address, ctx.territory.state);

      out.push({
        source: "bizdata",
        nativeId,
        profileUrl: /^\d+$/.test(nativeId) ? `https://www.openstreetmap.org/node/${nativeId}` : null,
        name: b.name,
        phone: b.phone?.trim() || null,
        website: b.website?.trim() || null,
        address: b.address ?? null,
        city,
        state,
        postalCode,
        lat: typeof lat === "number" ? lat : null,
        lng: typeof lng === "number" ? lng : null,
        rating: null,
        reviewCount: null,
        photoCount: null,
        // opening_hours present = confirmed hours; absent = unknown (OSM sparsity).
        hasHours: b.opening_hours ? true : null,
        businessStatus: null,
        categories: b.category === "real_estate" ? ["real_estate_agency"] : b.category ? [b.category] : [],
      });
    }
    return out.slice(0, ctx.limit);
  },
};
