import "server-only";
import type { NicheId } from "../types";
import { getNiche } from "../niches";
import {
  fetchJson,
  type SearchContext,
  type SourceProvider,
  type SourceRecord,
} from "./types";

/**
 * Google Places API (New) — optional, key required, billed by field mask.
 * Kept as a provider because it's the only source whose "no website on file"
 * is authoritative, and its review counts complement Yelp's.
 */
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.types",
  "places.photos",
  "places.regularOpeningHours",
  "places.location",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlacesResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  types?: string[];
  photos?: unknown[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
}

interface TextSearchResponse {
  places?: PlacesResult[];
  nextPageToken?: string;
}

function apiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

function pickComponent(
  components: PlacesAddressComponent[] | undefined,
  type: string,
  form: "long" | "short" = "long",
): string | null {
  const hit = components?.find((c) => c.types?.includes(type));
  if (!hit) return null;
  return (form === "short" ? hit.shortText : hit.longText) ?? null;
}

function toRecord(p: PlacesResult): SourceRecord | null {
  if (!p.id || !p.displayName?.text) return null;
  const components = p.addressComponents;
  return {
    source: "google_places",
    nativeId: p.id,
    profileUrl: p.googleMapsUri ?? null,
    name: p.displayName.text,
    phone: p.nationalPhoneNumber ?? null,
    // Google Places does not return business email addresses.
    email: null,
    website: p.websiteUri ?? null,
    address: p.formattedAddress ?? null,
    city:
      pickComponent(components, "locality") ??
      pickComponent(components, "postal_town") ??
      pickComponent(components, "administrative_area_level_2"),
    state: pickComponent(components, "administrative_area_level_1", "short"),
    postalCode: pickComponent(components, "postal_code"),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: p.userRatingCount ?? 0,
    photoCount: p.photos?.length ?? 0,
    hasHours: Boolean(p.regularOpeningHours?.weekdayDescriptions?.length),
    businessStatus: p.businessStatus ?? null,
    categories: p.types ?? [],
  };
}

export const googleProvider: SourceProvider = {
  id: "google_places",
  label: "Google Places",
  needsKey: true,

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  statusDetail(): string {
    if (!this.isConfigured()) {
      return "RECOMMENDED — this is the only source with real coverage of US junk removal and real estate businesses. Set GOOGLE_PLACES_API_KEY and redeploy. Without it, expect very few results.";
    }
    return "Connected. Comprehensive coverage plus definitive website data, review counts and listing completeness.";
  },

  supportsNiche(): boolean {
    return true;
  },

  async search(ctx: SearchContext): Promise<SourceRecord[]> {
    const key = apiKey();
    if (!key) return [];

    const out: SourceRecord[] = [];
    const seen = new Set<string>();

    // Google is the primary source, so run the fuller query set — the free
    // providers can't be relied on for breadth. Capped at 4 to keep the
    // field-mask bill predictable and stay inside the function time budget.
    const queries = getNiche(ctx.niche).queries.slice(0, 4);

    for (const template of queries) {
      const query = template.replace("{area}", ctx.territory.area);
      let pageToken: string | undefined;

      while (out.length < ctx.limit) {
        const body: Record<string, unknown> = {
          textQuery: query,
          pageSize: Math.min(20, ctx.limit - out.length),
        };
        if (pageToken) body.pageToken = pageToken;

        const data = await fetchJson<TextSearchResponse>(
          TEXT_SEARCH_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": key,
              "X-Goog-FieldMask": FIELD_MASK,
            },
            body: JSON.stringify(body),
            signal: ctx.signal,
          },
          "google_places",
        );

        for (const p of data.places ?? []) {
          const rec = toRecord(p);
          if (rec && !seen.has(rec.nativeId)) {
            seen.add(rec.nativeId);
            out.push(rec);
          }
        }

        if (!data.nextPageToken || !data.places?.length) break;
        pageToken = data.nextPageToken;
      }

      if (out.length >= ctx.limit) break;
    }

    return out.slice(0, ctx.limit);
  },
};
