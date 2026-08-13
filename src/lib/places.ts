import "server-only";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/**
 * Only the fields we actually score on. Places (New) bills by field mask, so
 * keeping this tight keeps the daily scan cheap.
 */
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

/** Flattened Places result, ready for the scorer and the storage layer. */
export interface PlaceRecord {
  sourceId: string;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  rating: number | null;
  reviewCount: number;
  photoCount: number;
  hasHours: boolean;
  businessStatus: string | null;
  categories: string[];
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());
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

function toRecord(p: PlacesResult): PlaceRecord | null {
  if (!p.id || !p.displayName?.text) return null;

  const components = p.addressComponents;
  return {
    sourceId: p.id,
    name: p.displayName.text,
    phone: p.nationalPhoneNumber ?? null,
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
    mapsUrl: p.googleMapsUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: p.userRatingCount ?? 0,
    photoCount: p.photos?.length ?? 0,
    hasHours: Boolean(p.regularOpeningHours?.weekdayDescriptions?.length),
    businessStatus: p.businessStatus ?? null,
    categories: p.types ?? [],
  };
}

export class PlacesError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

interface SearchOptions {
  /** Max results to pull per query. Places returns 20 per page, 60 max. */
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Run one Places Text Search, following pagination up to `limit` results.
 * Throws `PlacesError` on auth/quota problems so the scanner can report them
 * instead of silently returning nothing.
 */
export async function textSearch(
  query: string,
  { limit = 40, signal }: SearchOptions = {},
): Promise<PlaceRecord[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) throw new PlacesError("GOOGLE_PLACES_API_KEY is not set");

  const out: PlaceRecord[] = [];
  let pageToken: string | undefined;

  while (out.length < limit) {
    const body: Record<string, unknown> = {
      textQuery: query,
      pageSize: Math.min(20, limit - out.length),
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PlacesError(
        `Places search failed (${res.status}): ${text.slice(0, 300)}`,
        res.status,
      );
    }

    const data = (await res.json()) as TextSearchResponse;
    for (const p of data.places ?? []) {
      const rec = toRecord(p);
      if (rec) out.push(rec);
    }

    if (!data.nextPageToken || !data.places?.length) break;
    pageToken = data.nextPageToken;
  }

  return out.slice(0, limit);
}
