import "server-only";
import type { NicheId } from "../types";
import {
  SourceError,
  fetchJson,
  type SearchContext,
  type SourceProvider,
  type SourceRecord,
} from "./types";

/**
 * Geoapify Places API v2 — https://api.geoapify.com/v2/places
 *
 *   GET /v2/places?categories=<list>&filter=circle:<lon>,<lat>,<metres>&limit=N&apiKey=KEY
 *
 * Returns GeoJSON: { features: [ { properties: { name, street, city, state,
 * postcode, lon, lat, place_id, categories, datasource: { raw: {…OSM tags} } } } ] }
 *
 * Contact details live in `datasource.raw` (the untouched OSM tags), which is
 * where phone/website actually appear; the flattened properties sometimes
 * carry them too, so both are checked.
 *
 * Geoapify's data is OpenStreetMap-derived, so coverage of US service
 * businesses is the same as OSM's — decent for real-estate offices, thin for
 * junk haulers. Its real advantage over raw Overpass is reliability: a proper
 * API with a key, no cloud-host blocking, and a working geocoder.
 */
const PLACES_URL = "https://api.geoapify.com/v2/places";

/**
 * Category candidates per niche. Geoapify's taxonomy is hierarchical and it
 * rejects unknown category names outright, so each candidate is requested in
 * its own call and a rejection just drops that one — a bad guess can never
 * take the whole provider down. Override with GEOAPIFY_CATEGORIES_* if you
 * find better ones for your area.
 */
const CATEGORY_CANDIDATES: Record<NicheId, string[]> = {
  real_estate: ["commercial.real_estate", "office.estate_agent"],
  junk_removal: ["service.vehicle", "commercial.trade", "commercial.garden"],
};

/** Name keywords used to sift junk-removal operators out of broad categories. */
const JUNK_NAME_PATTERN =
  /junk|haul|cleanout|clean[- ]?out|rubbish|debris|dumpster|carting|refuse|scrap|disposal|removal/i;

function apiKey(): string | null {
  return process.env.GEOAPIFY_API_KEY?.trim() || null;
}

function categoriesFor(niche: NicheId): string[] {
  const override =
    niche === "real_estate"
      ? process.env.GEOAPIFY_CATEGORIES_REAL_ESTATE
      : process.env.GEOAPIFY_CATEGORIES_JUNK_REMOVAL;
  if (override?.trim()) {
    return override.split(",").map((c) => c.trim()).filter(Boolean);
  }
  return CATEGORY_CANDIDATES[niche];
}

interface GeoapifyProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  state?: string;
  state_code?: string;
  postcode?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  lon?: number;
  lat?: number;
  place_id?: string;
  categories?: string[];
  website?: string;
  phone?: string;
  email?: string;
  opening_hours?: string;
  datasource?: {
    sourcename?: string;
    raw?: Record<string, unknown>;
  };
}

interface GeoapifyResponse {
  features?: Array<{ properties?: GeoapifyProperties }>;
}

/** Read a tag from the raw OSM blob, tolerating its several spellings. */
function rawTag(raw: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toRecord(props: GeoapifyProperties, fallbackState: string): SourceRecord | null {
  const name = props.name?.trim();
  if (!name) return null;

  const raw = props.datasource?.raw;
  const osmId = rawTag(raw, "osm_id") ?? (raw?.osm_id != null ? String(raw.osm_id) : null);
  const osmType = rawTag(raw, "osm_type");

  const website =
    props.website?.trim() ||
    rawTag(raw, "website", "contact:website", "url", "contact:facebook");
  const phone =
    props.phone?.trim() || rawTag(raw, "phone", "contact:phone", "contact:mobile");
  const email = props.email?.trim() || rawTag(raw, "email", "contact:email");
  const hours = props.opening_hours?.trim() || rawTag(raw, "opening_hours");

  const street = [props.housenumber, props.street].filter(Boolean).join(" ");
  const address =
    props.formatted?.trim() ||
    [street || null, props.city, props.state_code ?? props.state, props.postcode]
      .filter(Boolean)
      .join(", ") ||
    null;

  return {
    source: "geoapify",
    nativeId: props.place_id ?? (osmId ? `${osmType ?? "n"}/${osmId}` : `${name}|${props.lat}|${props.lon}`),
    profileUrl:
      osmId && osmType ? `https://www.openstreetmap.org/${osmType}/${osmId}` : null,
    name,
    phone,
    email,
    website,
    address,
    city: props.city?.trim() || null,
    state: props.state_code?.trim() || props.state?.trim() || fallbackState || null,
    postalCode: props.postcode?.trim() || null,
    lat: typeof props.lat === "number" ? props.lat : null,
    lng: typeof props.lon === "number" ? props.lon : null,
    rating: null,
    reviewCount: null,
    photoCount: null,
    // Present = confirmed hours; absent = unknown, not "no hours".
    hasHours: hours ? true : null,
    businessStatus: null,
    categories: props.categories ?? [],
  };
}

export const geoapifyProvider: SourceProvider = {
  id: "geoapify",
  label: "Geoapify",
  needsKey: true,

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  statusDetail(): string {
    if (!this.isConfigured()) {
      return "Set GEOAPIFY_API_KEY to enable. Also powers the geocoder, which fixes OpenStreetMap radius search on Vercel.";
    }
    return "Connected. Reliable OpenStreetMap-derived place search, and it powers the geocoder so radius searches work on Vercel. Coverage of US service businesses is still OSM-level — pair it with Google Places for depth.";
  },

  supportsNiche(): boolean {
    return true;
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const key = apiKey();
    if (!key) return [];

    const { territory } = ctx;
    if (territory.lat === null || territory.lng === null) {
      throw new SourceError(
        `Territory "${territory.label}" has no coordinates yet — geocoding hasn't run.`,
        "geoapify",
      );
    }

    const radius = Math.min(Math.round(territory.radiusKm * 1000), 50000);
    const out: SourceRecord[] = [];
    const seen = new Set<string>();
    const rejected: string[] = [];

    // Each category is a separate call so one unknown name can't fail them all.
    for (const category of categoriesFor(ctx.niche)) {
      if (out.length >= ctx.limit) break;

      const url = new URL(PLACES_URL);
      url.searchParams.set("categories", category);
      url.searchParams.set("filter", `circle:${territory.lng},${territory.lat},${radius}`);
      url.searchParams.set("bias", `proximity:${territory.lng},${territory.lat}`);
      url.searchParams.set("limit", String(Math.min(ctx.limit, 500)));
      url.searchParams.set("apiKey", key);

      let data: GeoapifyResponse;
      try {
        data = await fetchJson<GeoapifyResponse>(
          url.toString(),
          { signal: ctx.signal, timeoutMs: 25000 },
          "geoapify",
        );
      } catch (err) {
        // A 400 means Geoapify doesn't know this category — skip it quietly.
        if (err instanceof SourceError && err.status === 400) {
          rejected.push(category);
          continue;
        }
        throw err;
      }

      for (const feature of data.features ?? []) {
        const rec = toRecord(feature.properties ?? {}, territory.state);
        if (!rec || seen.has(rec.nativeId)) continue;

        // Junk removal has no clean Geoapify category, so broad categories are
        // sifted by name; the scorer's niche check catches anything left over.
        if (ctx.niche === "junk_removal" && !JUNK_NAME_PATTERN.test(rec.name)) continue;

        seen.add(rec.nativeId);
        out.push(rec);
        if (out.length >= ctx.limit) break;
      }
    }

    if (!out.length && rejected.length === categoriesFor(ctx.niche).length) {
      throw new SourceError(
        `Geoapify rejected every category tried (${rejected.join(", ")}). Set GEOAPIFY_CATEGORIES_${ctx.niche === "real_estate" ? "REAL_ESTATE" : "JUNK_REMOVAL"} to valid category names from Geoapify's list.`,
        "geoapify",
      );
    }

    return out;
  },
};
