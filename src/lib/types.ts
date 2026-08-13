export type NicheId = "junk_removal" | "real_estate";

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
  /** Google Places resource id, or a synthetic id for demo/manual rows. Dedupe key. */
  sourceId: string;
  source: "google_places" | "manual" | "demo";

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
  reviewCount: number;
  photoCount: number;
  hasHours: boolean;
  businessStatus: string | null;
  /** Google's own category strings, e.g. ["moving_company", "point_of_interest"]. */
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
  /** Free-text locality used to build the Places query, e.g. "Norwood, MA". */
  area: string;
  state: string;
  niches: NicheId[];
  enabled: boolean;
  createdAt: string;
  lastScannedAt: string | null;
  /** Rolling count of leads this territory has produced. */
  leadsFound: number;
}

export interface ScanRunSummary {
  startedAt: string;
  finishedAt: string;
  territoriesScanned: number;
  placesInspected: number;
  newLeads: number;
  updatedLeads: number;
  skipped: number;
  errors: string[];
  /** True when no Places key was configured and the run was a no-op. */
  demoMode: boolean;
}

export interface LeadFilters {
  q?: string;
  niches?: NicheId[];
  tiers?: PresenceTier[];
  statuses?: LeadStatus[];
  states?: string[];
  cities?: string[];
  minScore?: number;
  maxScore?: number;
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
