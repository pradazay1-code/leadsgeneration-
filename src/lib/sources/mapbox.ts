import "server-only";
import type { NicheId } from "../types";
import { QuotaExceededError, reserve } from "../quota";
import {
  SourceError,
  fetchJson,
  type SearchContext,
  type SourceProvider,
  type SourceRecord,
} from "./types";

/**
 * Mapbox Search Box API — the primary discovery source.
 *
 * Uses `/forward` (free-text search) rather than `/category`, which matters:
 * forward search takes an arbitrary query like "junk removal", so there is no
 * category taxonomy to guess at. Category ids are only used as an optional
 * supplement where a well-known one exists.
 *
 *   GET /search/searchbox/v1/forward
 *       ?q=junk+removal&proximity=lon,lat&limit=10&types=poi&access_token=...
 *
 * Response is GeoJSON; POI contact details live in `properties.metadata`
 * (phone, website) and `properties.context` carries the address parts.
 *
 * Billing: /forward and /category are charged per request, 25,000/month free.
 * Every call is reserved against the `mapbox_search` quota first.
 */
const FORWARD_URL = "https://api.mapbox.com/search/searchbox/v1/forward";

/** Free-text queries per niche. `{area}` is not used — proximity does the work. */
const QUERIES: Record<NicheId, string[]> = {
  junk_removal: [
    "junk removal",
    "junk hauling",
    "dumpster rental",
    "estate cleanout service",
  ],
  real_estate: [
    "real estate agency",
    "realtor",
    "property management",
  ],
};

/**
 * Optional category ids, used only when Mapbox accepts them. Unknown ids are
 * skipped silently rather than failing the provider.
 */
const CATEGORY_HINTS: Partial<Record<NicheId, string[]>> = {
  real_estate: ["real_estate_agent"],
};

interface MapboxContextPart {
  name?: string;
  region_code?: string;
}

interface MapboxProperties {
  name?: string;
  mapbox_id?: string;
  feature_type?: string;
  full_address?: string;
  address?: string;
  place_formatted?: string;
  poi_category?: string[];
  poi_category_ids?: string[];
  coordinates?: { longitude?: number; latitude?: number };
  metadata?: {
    phone?: string;
    website?: string;
    open_hours?: unknown;
  };
  context?: {
    place?: MapboxContextPart;
    locality?: MapboxContextPart;
    region?: MapboxContextPart;
    postcode?: MapboxContextPart;
    country?: MapboxContextPart;
  };
}

interface MapboxResponse {
  features?: Array<{ properties?: MapboxProperties }>;
}

export function mapboxToken(): string | null {
  return (
    process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
    process.env.MAPBOX_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ||
    null
  );
}

function toRecord(props: MapboxProperties, fallbackState: string): SourceRecord | null {
  const name = props.name?.trim();
  if (!name) return null;
  // Only points of interest are businesses; addresses and streets are noise.
  if (props.feature_type && props.feature_type !== "poi") return null;

  const ctx = props.context;
  const meta = props.metadata;

  return {
    source: "mapbox",
    nativeId: props.mapbox_id ?? `${name}|${props.coordinates?.longitude}|${props.coordinates?.latitude}`,
    profileUrl: null,
    name,
    phone: meta?.phone?.trim() || null,
    email: null,
    // Mapbox returns a website when it has one, so absence here is real
    // evidence rather than a gap in the dataset.
    website: meta?.website?.trim() || null,
    address: props.full_address?.trim() || props.place_formatted?.trim() || null,
    city: ctx?.place?.name?.trim() || ctx?.locality?.name?.trim() || null,
    state: ctx?.region?.region_code?.trim() || ctx?.region?.name?.trim() || fallbackState || null,
    postalCode: ctx?.postcode?.name?.trim() || null,
    lat: props.coordinates?.latitude ?? null,
    lng: props.coordinates?.longitude ?? null,
    rating: null,
    reviewCount: null,
    photoCount: null,
    hasHours: meta?.open_hours ? true : null,
    businessStatus: null,
    categories: [...(props.poi_category_ids ?? []), ...(props.poi_category ?? [])],
  };
}

export const mapboxProvider: SourceProvider = {
  id: "mapbox",
  label: "Mapbox",
  needsKey: true,
  needsCoordinates: true,

  isConfigured(): boolean {
    return Boolean(mapboxToken());
  },

  statusDetail(): string {
    if (!this.isConfigured()) {
      return "Your main discovery source. Set MAPBOX_ACCESS_TOKEN and redeploy. Free tier: 25,000 searches/month.";
    }
    return "Connected. Free-text POI search with phone and website metadata, capped well inside the 25,000/month free tier.";
  },

  supportsNiche(): boolean {
    return true;
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const token = mapboxToken();
    if (!token) return [];

    const { territory } = ctx;
    if (territory.lat === null || territory.lng === null) {
      throw new SourceError(
        `Territory "${territory.label}" has no coordinates yet — geocoding hasn't run.`,
        "mapbox",
      );
    }

    const out: SourceRecord[] = [];
    const seen = new Set<string>();
    const queries = QUERIES[ctx.niche];
    const categories = CATEGORY_HINTS[ctx.niche] ?? [];

    for (const q of queries) {
      if (out.length >= ctx.limit) break;

      // Reserve budget before every single call — this is what keeps usage
      // inside the free tier even if a scan is triggered repeatedly.
      const allowed = await reserve("mapbox_search");
      if (!allowed.ok) {
        throw new QuotaExceededError(allowed.reason ?? "Mapbox quota exhausted", "mapbox_search");
      }

      const url = new URL(FORWARD_URL);
      url.searchParams.set("q", q);
      url.searchParams.set("access_token", token);
      url.searchParams.set("proximity", `${territory.lng},${territory.lat}`);
      url.searchParams.set("limit", "10");
      url.searchParams.set("types", "poi");
      url.searchParams.set("country", "us");
      url.searchParams.set("language", "en");

      const data = await fetchJson<MapboxResponse>(
        url.toString(),
        { signal: ctx.signal, timeoutMs: 20000 },
        "mapbox",
      );

      for (const feature of data.features ?? []) {
        const rec = toRecord(feature.properties ?? {}, territory.state);
        if (!rec || seen.has(rec.nativeId)) continue;
        seen.add(rec.nativeId);
        out.push(rec);
        if (out.length >= ctx.limit) break;
      }
    }

    // Category search as a supplement, tolerating unknown ids.
    for (const category of categories) {
      if (out.length >= ctx.limit) break;
      const allowed = await reserve("mapbox_search");
      if (!allowed.ok) break;

      const url = new URL(
        `https://api.mapbox.com/search/searchbox/v1/category/${encodeURIComponent(category)}`,
      );
      url.searchParams.set("access_token", token);
      url.searchParams.set("proximity", `${territory.lng},${territory.lat}`);
      url.searchParams.set("limit", "25");
      url.searchParams.set("country", "us");

      try {
        const data = await fetchJson<MapboxResponse>(
          url.toString(),
          { signal: ctx.signal, timeoutMs: 20000 },
          "mapbox",
        );
        for (const feature of data.features ?? []) {
          const rec = toRecord(feature.properties ?? {}, territory.state);
          if (!rec || seen.has(rec.nativeId)) continue;
          seen.add(rec.nativeId);
          out.push(rec);
          if (out.length >= ctx.limit) break;
        }
      } catch (err) {
        // An unknown category id is not a provider failure.
        if (err instanceof SourceError && (err.status === 400 || err.status === 404)) continue;
        throw err;
      }
    }

    return out;
  },
};
