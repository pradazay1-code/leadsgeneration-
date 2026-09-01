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
  email: string | null;
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

  /* --- Research fields. Only the deep-research source fills these in. --- */
  /** Owner, founder or principal agent, when the business names one. */
  ownerName?: string | null;
  /** Year the business says it started. */
  foundedYear?: number | null;
  /** True when the page presents the business as newly launched. */
  looksNew?: boolean | null;
  /** Which research angle surfaced this, for the scan report. */
  researchAngle?: string | null;
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
  /**
   * True when search() can't run without territory coordinates. The scan uses
   * this to decide whether geocoding is worth attempting at all, so a geocoder
   * outage only disables the providers that actually depend on one.
   */
  needsCoordinates: boolean;
  /** Short status line for the Settings page. */
  statusDetail(): string;
  /** Which niches this provider can search. */
  supportsNiche(niche: NicheId): boolean;
  search(ctx: SearchContext): Promise<SourceRecord[]>;
}

export class SourceError extends Error {
  readonly source: SourceId;
  /** HTTP-ish status when known; auth/quota errors abort the provider for the run. */
  readonly status?: number;
  /** Server-suggested wait before retrying, from a Retry-After header. */
  retryAfterMs?: number | null;

  // Fields are assigned in the body rather than declared as constructor
  // parameter properties, which need a TypeScript transform this module can't
  // assume — it has to load under plain type-stripping too.
  constructor(message: string, source: SourceId, status?: number) {
    super(message);
    this.name = "SourceError";
    this.source = source;
    this.status = status;
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
// Mapbox POI metadata, a confirmed web search, and a deep-research pass that
// actually went looking are the sources that can establish "this business has
// no website" as a finding rather than a gap in someone's dataset.
export const WEBSITE_AUTHORITATIVE: SourceId[] = ["mapbox", "web", "firecrawl"];

/** Platforms that publish review counts. */
export const REVIEW_PLATFORMS: SourceId[] = ["yelp"];

/** Merge priority — richer platforms win field conflicts. */
export const SOURCE_PRIORITY: SourceId[] = [
  // Firecrawl leads on field conflicts: it reads the business's own page, so
  // its owner name, email and phone come from the horse's mouth rather than
  // from a third-party listing that may be years stale.
  "firecrawl",
  "mapbox",
  "yelp",
  "geoapify",
  "web",
  "bizdata",
  "osm",
  "manual",
];

export const SOURCE_LABELS: Record<SourceId, string> = {
  mapbox: "Mapbox",
  firecrawl: "Deep research",
  web: "Web research",
  bizdata: "BizData",
  osm: "OpenStreetMap",
  geoapify: "Geoapify",
  yelp: "Yelp",
  manual: "Manual",
};

/**
 * Statuses worth trying again. A 429 or a 5xx is the upstream having a moment,
 * not a verdict — but without a retry a single blip benched the source for the
 * whole run, losing every result it would have returned. 401/403/404 are
 * answers, and retrying them only wastes budget.
 */
function isTransient(status: number | undefined): boolean {
  return status === 429 || status === 408 || (status !== undefined && status >= 500);
}

/** Honour Retry-After when the server sends one, within reason. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(Math.max(0, at - Date.now()), 10_000) : null;
}

/**
 * Shared fetch wrapper: UA header, timeout, bounded retry, JSON parse, typed
 * errors.
 *
 * Retries are deliberately few and short. The scan runs against a wall-clock
 * budget on serverless, so a patient retry loop would spend the whole run
 * waiting on one sulking provider and starve every other source.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number },
  source: SourceId,
): Promise<T> {
  const { timeoutMs = 25000, retries = 2, ...rest } = init;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await attemptFetch<T>(url, rest, timeoutMs, source);
    } catch (err) {
      lastError = err;

      const status = err instanceof SourceError ? err.status : undefined;
      const retryable = status === undefined ? isNetworkBlip(err) : isTransient(status);
      if (!retryable || attempt === retries) throw err;

      // 400ms, then 1200ms — enough to clear a rate-limit window without
      // eating the scan's time budget.
      const backoff =
        (err instanceof SourceError && err.retryAfterMs) || 400 * Math.pow(3, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError;
}

/** A dropped connection or a timeout, as opposed to a considered rejection. */
function isNetworkBlip(err: unknown): boolean {
  if (err instanceof SourceError && err.status !== undefined) return false;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // An abort raised by the caller's own signal must not be retried.
  if (message.includes("timed out") || message.includes("timeout")) return true;
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}

async function attemptFetch<T>(
  url: string,
  rest: RequestInit,
  timeoutMs: number,
  source: SourceId,
): Promise<T> {
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
      const error = new SourceError(
        `${source} request failed (${res.status}): ${text.slice(0, 200)}`,
        source,
        res.status,
      );
      error.retryAfterMs = retryAfterMs(res);
      throw error;
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
