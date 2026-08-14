export type NicheId = "junk_removal" | "real_estate";

/** Where a lead's data can come from. */
export type SourceId = "bizdata" | "osm" | "yelp" | "google_places" | "manual";

/** Per-source reference back to the original listing. */
export interface SourceRef {
  /** Provider-native id (OSM element id, Yelp business id, Place id…). */
  id: string;
  /** Public listing URL on that platform, when one exists. */
  url: string | null;
}

export type SourceRefs = Partial<Record<SourceId, SourceRef>>;

/**
 * How much of a digital footprint a business has already built.
 * Ordered weakest -> strongest. `established` leads are the ones we do NOT want:
 * they already solved the problem the agency sells.
 */
export type PresenceTier = "none" | "minimal" | "weak" | "established";

export type LeadStatus =
  | "new"
  | "contacted"
  | "responded"
  | "qualified"
  | "won"
  | "lost"
  | "ignored";

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "responded",
  "qualified",
  "won",
  "lost",
  "ignored",
];

/** A single reason the scoring engine moved a lead's score up or down. */
export interface ScoreSignal {
  /** Stable machine key, e.g. "no_website". */
  key: string;
  /** Human-readable line shown in the score breakdown UI. */
  label: string;
  /** Positive = better lead for us. Negative = more established, worse fit. */
  points: number;
}

export interface ScoreResult {
  /** 0-100, higher = better prospect for the agency. */
  score: number;
  tier: PresenceTier;
  signals: ScoreSignal[];
  /** Set when the business should be filtered out entirely (franchise, closed, etc.). */
  disqualified: boolean;
  disqualifiedReason?: string;
}

export interface Lead {
  id: string;
  /** Canonical dedupe key (merged identity), unique per business. */
  sourceId: string;
  /** Primary source — the richest platform this lead was seen on. */
  source: SourceId;
  /** Every platform this lead was seen on. */
  sources: SourceId[];
  /** Links back to each platform's listing. */
  sourceRefs: SourceRefs;

  name: string;
  niche: NicheId;

  phone: string | null;
  website: string | null;
  /** Normalised hostname of `website`, e.g. "acmejunk.com". */
  websiteHost: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;

  rating: number | null;
  /**
   * Combined review count across platforms that publish reviews.
   * `null` = no review platform has this business (or none was checked).
   */
  reviewCount: number | null;
  /** `null` = no source that counts photos saw this business. */
  photoCount: number | null;
  /** `null` = unknown (the sources that saw it don't reliably publish hours). */
  hasHours: boolean | null;
  businessStatus: string | null;
  /** Normalised category strings from every source. */
  categories: string[];

  score: number;
  tier: PresenceTier;
  signals: ScoreSignal[];

  status: LeadStatus;
  notes: string;
  /** ISO timestamp. When this lead first entered the database. */
  discoveredAt: string;
  /** ISO timestamp. Last time a scan re-confirmed / refreshed this row. */
  lastSeenAt: string;
  /** Territory that surfaced this lead first. */
  territoryId: string | null;
}

/**
 * A saved "place x niche" pair the daily scan sweeps. The scanner walks every
 * enabled territory once per run.
 */
export interface Territory {
  id: string;
  label: string;
  /** Free-text locality used to build source queries, e.g. "Norwood, MA". */
  area: string;
  state: string;
  niches: NicheId[];
  /** Search radius around the geocoded centre, km. */
  radiusKm: number;
  /** Geocoded centre (cached from Nominatim; null until first geocode). */
  lat: number | null;
  lng: number | null;
  enabled: boolean;
  createdAt: string;
  lastScannedAt: string | null;
  /** Rolling count of leads this territory has produced. */
  leadsFound: number;
}

/** Per-source outcome for one scan run — this is what makes failures visible. */
export interface SourceScanStat {
  source: SourceId;
  /** Raw listings the provider returned across all territories. */
  returned: number;
  /** Queries attempted. */
  queries: number;
  /** Errors this provider hit, verbatim. */
  errors: string[];
  /** True when the provider was skipped (not configured / niche unsupported). */
  skipped: boolean;
  skipReason?: string;
}

export interface ScanRunSummary {
  startedAt: string;
  finishedAt: string;
  territoriesScanned: number;
  placesInspected: number;
  newLeads: number;
  updatedLeads: number;
  /** Candidates dropped as established, franchise, off-niche, or below cutoff. */
  skipped: number;
  /** Which providers actually returned data. */
  sourcesUsed: SourceId[];
  /** Full per-source breakdown, so a silent zero is always explainable. */
  sourceStats: SourceScanStat[];
  errors: string[];
  /** True when no source could run at all. */
  noSourcesConfigured: boolean;
}

export interface LeadFilters {
  q?: string;
  niches?: NicheId[];
  tiers?: PresenceTier[];
  statuses?: LeadStatus[];
  states?: string[];
  cities?: string[];
  /** Match leads seen on ANY of these sources. */
  sources?: SourceId[];
  minScore?: number;
  maxScore?: number;
  /** Unknown review counts (null) always pass — they're the most under-the-radar. */
  maxReviews?: number;
  hasWebsite?: boolean;
  hasPhone?: boolean;
  /** Only leads discovered within the last N days. */
  discoveredWithinDays?: number;
  sort?: LeadSort;
  limit?: number;
  offset?: number;
}

export type LeadSort =
  | "score_desc"
  | "score_asc"
  | "newest"
  | "oldest"
  | "reviews_asc"
  | "reviews_desc"
  | "name_asc";

export interface LeadStats {
  total: number;
  newToday: number;
  newThisWeek: number;
  untouched: number;
  noWebsite: number;
  byTier: Record<PresenceTier, number>;
  byStatus: Record<LeadStatus, number>;
  byNiche: Record<NicheId, number>;
  avgScore: number;
}

/** Provider status line for the Settings page. */
export interface ProviderStatus {
  id: SourceId;
  label: string;
  /** Ready to run (has key if it needs one, not disabled). */
  configured: boolean;
  /** Whether this provider needs an API key at all. */
  needsKey: boolean;
  detail: string;
}
