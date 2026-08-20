import type { NicheId, SourceId, Territory } from "../types";

/**
 * One business as reported by a single platform, before cross-source merging.
 * `null` means "this platform doesn't know", never "confirmed absent" — with
 * one exception: `website: null` from a platform listed in
 * `WEBSITE_AUTHORITATIVE` genuinely means the platform has no site on file.
 */
export interface SourceRecord {
  source: SourceId;
  /** Provider-native id, stable across scans. */
  nativeId: string;
  /** Public listing URL on the platform, when there is one. */
  profileUrl: string | null;

  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;

  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  hasHours: boolean | null;
  /** "CLOSED" when the platform marks the business closed. */
  businessStatus: string | null;
  /** Normalised category hints, e.g. "real_estate_agency", "junk_removal". */
  categories: string[];
}

export interface SearchContext {
  niche: NicheId;
  territory: Territory;
  /** Cap per provider per territory×niche. */
  limit: number;
  signal?: AbortSignal;
}

export interface SourceProvider {
  id: SourceId;
  label: string;
  /** True when the provider can run right now (key present, not disabled). */
  isConfigured(): boolean;
  /** Whether this provider requires an API key. */
  needsKey: boolean;
  /** Short status line for the Settings page. */
  statusDetail(): string;
  /** Which niches this provider can search. */
  supportsNiche(niche: NicheId): boolean;
  search(ctx: SearchContext): Promise<SourceRecord[]>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly source: SourceId,
    /** HTTP-ish status when known; auth/quota errors abort the provider for the run. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }

  get fatal(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 429;
  }
}

/**
 * Platforms whose "no website on file" is strong evidence the business really
 * has none. OSM-derived data (bizdata, osm) frequently just hasn't recorded
 * the tag, and Yelp's API never exposes business websites at all.
 */
export const WEBSITE_AUTHORITATIVE: SourceId[] = ["google_places"];

/** Platforms that publish review counts. */
export const REVIEW_PLATFORMS: SourceId[] = ["yelp", "google_places"];

/** Merge priority — richer platforms win field conflicts. */
export const SOURCE_PRIORITY: SourceId[] = [
  "google_places",
  "yelp",
  "geoapify",
  "bizdata",
  "osm",
  "manual",
];

export const SOURCE_LABELS: Record<SourceId, string> = {
  bizdata: "BizData",
  osm: "OpenStreetMap",
  geoapify: "Geoapify",
  yelp: "Yelp",
  google_places: "Google Places",
  manual: "Manual",
};

/** Shared fetch wrapper: UA header, timeout, JSON parse, typed errors. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  source: SourceId,
): Promise<T> {
  const { timeoutMs = 25000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "LeadSignal/1.0 (+https://github.com/pradazay1-code/leadsgeneration-)",
        ...rest.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SourceError(
        `${source} request failed (${res.status}): ${text.slice(0, 200)}`,
        source,
        res.status,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SourceError(`${source} request failed: ${message}`, source);
  } finally {
    clearTimeout(timer);
  }
}
