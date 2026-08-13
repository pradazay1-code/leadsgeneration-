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
 * Direct OpenStreetMap Overpass source — free, keyless, and unlike BizData's
 * fixed category list it can hunt junk removal companies by name pattern.
 *
 * Real estate: `office=estate_agent` is the standard OSM tag.
 * Junk removal: no dedicated tag exists, so match business names against the
 * same keyword list the scorer uses (junk, hauling, cleanout, dumpster…).
 */
const DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function overpassUrl(): string {
  return process.env.OVERPASS_URL?.trim() || DEFAULT_OVERPASS;
}

/** Overpass QL for a niche around a point. */
function buildQuery(niche: NicheId, lat: number, lng: number, radiusKm: number): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat},${lng})`;

  if (niche === "real_estate") {
    return `[out:json][timeout:25];
(
  nwr["office"="estate_agent"]${around};
  nwr["office"="property_management"]${around};
  nwr["name"~"real estate|realty|realtor",i]["office"]${around};
);
out tags center 200;`;
  }

  // Junk removal: name-pattern match, constrained to elements that are at
  // least tagged as some kind of business so we don't match street names.
  const namePattern = "junk|hauling|haul away|cleanout|clean out|rubbish|debris removal|dumpster";
  return `[out:json][timeout:25];
(
  nwr["name"~"${namePattern}",i]["office"]${around};
  nwr["name"~"${namePattern}",i]["shop"]${around};
  nwr["name"~"${namePattern}",i]["craft"]${around};
  nwr["name"~"${namePattern}",i]["amenity"]${around};
  nwr["name"~"${namePattern}",i]["landuse"="industrial"]${around};
  nwr["name"~"${namePattern}",i]["phone"]${around};
  nwr["name"~"${namePattern}",i]["contact:phone"]${around};
);
out tags center 200;`;
}

function tag(tags: Record<string, string> | undefined, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = tags?.[k]?.trim();
    if (v) return v;
  }
  return null;
}

export function elementToRecord(
  el: OverpassElement,
  niche: NicheId,
  fallbackState: string,
): SourceRecord | null {
  const tags = el.tags;
  const name = tag(tags, "name");
  if (!name) return null;

  // Lifecycle prefixes mean the POI is gone.
  if (tags && Object.keys(tags).some((k) => /^(disused|abandoned|demolished|was):/.test(k))) {
    return null;
  }

  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;

  const website = tag(tags, "website", "contact:website", "contact:facebook", "url");
  const phone = tag(tags, "phone", "contact:phone", "contact:mobile");
  const city = tag(tags, "addr:city");
  const state = tag(tags, "addr:state") ?? (fallbackState || null);
  const postalCode = tag(tags, "addr:postcode");
  const street = [tag(tags, "addr:housenumber"), tag(tags, "addr:street")].filter(Boolean).join(" ");
  const address = [street || null, city, state].filter(Boolean).join(", ") || null;

  const categories: string[] = [];
  if (tag(tags, "office") === "estate_agent") categories.push("real_estate_agency");
  if (tag(tags, "office") === "property_management") categories.push("real_estate_agency");
  if (niche === "junk_removal") categories.push("junk_removal");

  return {
    source: "osm",
    nativeId: `${el.type}/${el.id}`,
    profileUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name,
    phone,
    website,
    address,
    city,
    state,
    postalCode,
    lat,
    lng,
    rating: null,
    reviewCount: null,
    photoCount: null,
    hasHours: tag(tags, "opening_hours") ? true : null,
    businessStatus: null,
    categories,
  };
}

export const osmProvider: SourceProvider = {
  id: "osm",
  label: "OpenStreetMap",
  needsKey: false,

  isConfigured(): boolean {
    return process.env.OSM_DISABLED !== "1";
  },

  statusDetail(): string {
    if (!this.isConfigured()) return "Disabled via OSM_DISABLED=1.";
    return "Free Overpass queries against OpenStreetMap — no key needed. Finds junk removal by name pattern.";
  },

  supportsNiche(): boolean {
    return true;
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const { territory } = ctx;
    if (territory.lat === null || territory.lng === null) {
      throw new SourceError(
        `Territory "${territory.label}" has no coordinates yet — geocoding failed or hasn't run.`,
        "osm",
      );
    }

    const query = buildQuery(ctx.niche, territory.lat, territory.lng, territory.radiusKm);
    const data = await fetchJson<OverpassResponse>(
      overpassUrl(),
      {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: ctx.signal,
        timeoutMs: 35000,
      },
      "osm",
    );

    const out: SourceRecord[] = [];
    const seen = new Set<string>();
    for (const el of data.elements ?? []) {
      const rec = elementToRecord(el, ctx.niche, territory.state);
      if (!rec || seen.has(rec.nativeId)) continue;
      seen.add(rec.nativeId);
      out.push(rec);
      if (out.length >= ctx.limit) break;
    }
    return out;
  },
};
