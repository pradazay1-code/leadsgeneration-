import { GENERIC_WEAK_DOMAINS, getNiche } from "./niches";
import { REVIEW_PLATFORMS, WEBSITE_AUTHORITATIVE } from "./sources/types";
import type { NicheId, PresenceTier, ScoreResult, ScoreSignal, SourceId } from "./types";

/**
 * Raw shape the scorer needs. Nullable fields mean "no source that knows this
 * saw the business" — the scorer treats unknown differently from confirmed-absent.
 */
export interface ScorableBusiness {
  name: string;
  niche: NicheId;
  website: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  hasHours: boolean | null;
  businessStatus: string | null;
  categories: string[];
  /** Platforms this business was actually seen on. */
  sources: SourceId[];
  /** Platforms that were queried for this territory×niche this scan. */
  checkedSources: SourceId[];
}

export interface WebsiteVerdict {
  /** No website field at all. */
  none: boolean;
  /** Website exists but is a social page, link-in-bio or free builder. */
  weakPlatform: boolean;
  /** Website is a brokerage/portal page the business does not control. */
  parasite: boolean;
  host: string | null;
  matchedDomain: string | null;
}

/** Strip protocol/www and lowercase, returning a bare hostname. */
export function normaliseHost(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when `host` is exactly `domain` or a subdomain of it. */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function assessWebsite(website: string | null, niche: NicheId): WebsiteVerdict {
  const host = normaliseHost(website);
  if (!host) {
    return { none: true, weakPlatform: false, parasite: false, host: null, matchedDomain: null };
  }

  const weak = GENERIC_WEAK_DOMAINS.find((d) => hostMatches(host, d));
  if (weak) {
    return { none: false, weakPlatform: true, parasite: false, host, matchedDomain: weak };
  }

  const parasite = getNiche(niche).parasiteDomains.find((d) => hostMatches(host, d));
  if (parasite) {
    return { none: false, weakPlatform: false, parasite: true, host, matchedDomain: parasite };
  }

  return { none: false, weakPlatform: false, parasite: false, host, matchedDomain: null };
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** National chain / big-brokerage check. These are never our customer. */
export function detectFranchise(name: string, niche: NicheId): string | null {
  const n = normaliseName(name);
  return getNiche(niche).franchises.find((f) => n.includes(f)) ?? null;
}

/**
 * Confirms a result actually belongs to the niche we searched for — provider
 * queries are fuzzy and name-pattern matches drag in noise.
 */
export function matchesNiche(name: string, categories: string[], niche: NicheId): boolean {
  const cfg = getNiche(niche);
  const n = normaliseName(name);

  if (cfg.nameKeywords.some((kw) => n.includes(kw))) return true;

  const generic = new Set(["point_of_interest", "establishment", "local_services"]);
  return categories.some((c) => cfg.includeTypes.includes(c) && !generic.has(c));
}

/**
 * Review-count curve. Review volume is the single best public proxy for how
 * long a local business has been operating and how much marketing gravity it
 * already has. Few reviews = new and reachable. Many = they already won.
 */
function reviewSignal(reviewCount: number): ScoreSignal {
  if (reviewCount === 0)
    return { key: "reviews_0", label: "Zero reviews on the platforms that count them — brand new or invisible", points: 24 };
  if (reviewCount <= 3)
    return { key: "reviews_1_3", label: `Only ${reviewCount} review(s) across platforms — just getting started`, points: 20 };
  if (reviewCount <= 10)
    return { key: "reviews_4_10", label: `${reviewCount} combined reviews — still early stage`, points: 15 };
  if (reviewCount <= 25)
    return { key: "reviews_11_25", label: `${reviewCount} combined reviews — building momentum`, points: 9 };
  if (reviewCount <= 60)
    return { key: "reviews_26_60", label: `${reviewCount} combined reviews — moderately established`, points: 2 };
  if (reviewCount <= 150)
    return { key: "reviews_61_150", label: `${reviewCount} combined reviews — well established`, points: -12 };
  return {
    key: "reviews_150_plus",
    label: `${reviewCount} combined reviews — dominant local player`,
    points: -25,
  };
}

/**
 * Turn a merged business into a 0-100 opportunity score plus an explainable
 * breakdown. The score is normalised against the best case *achievable with
 * the sources that were actually checked*, so "82" means the same thing
 * whether or not paid providers are connected.
 */
export function scoreBusiness(biz: ScorableBusiness): ScoreResult {
  const signals: ScoreSignal[] = [];

  // ---- Hard disqualifiers -------------------------------------------------
  const franchise = detectFranchise(biz.name, biz.niche);
  if (franchise) {
    return {
      score: 0,
      tier: "established",
      signals: [
        { key: "franchise", label: `National chain / franchise (“${franchise}”)`, points: 0 },
      ],
      disqualified: true,
      disqualifiedReason: `Franchise or national brand: ${franchise}`,
    };
  }

  if (biz.businessStatus && biz.businessStatus !== "OPERATIONAL") {
    return {
      score: 0,
      tier: "established",
      signals: [
        { key: "not_operational", label: `Marked ${biz.businessStatus} on its listing`, points: 0 },
      ],
      disqualified: true,
      disqualifiedReason: `Not operational (${biz.businessStatus})`,
    };
  }

  if (!matchesNiche(biz.name, biz.categories, biz.niche)) {
    return {
      score: 0,
      tier: "established",
      signals: [{ key: "off_niche", label: "Does not match the target niche", points: 0 }],
      disqualified: true,
      disqualifiedReason: "Off-niche result",
    };
  }

  const websiteAuthoritative = biz.sources.some((s) => WEBSITE_AUTHORITATIVE.includes(s));
  const reviewPlatformChecked = biz.checkedSources.some((s) => REVIEW_PLATFORMS.includes(s));
  const googleChecked = biz.checkedSources.includes("google_places");

  // ---- Website footprint (the heaviest signal) ----------------------------
  const web = assessWebsite(biz.website, biz.niche);
  if (web.none) {
    if (websiteAuthoritative) {
      signals.push({
        key: "no_website",
        label: "No website on file with Google — confirmed gap, top-priority opening",
        points: 30,
      });
    } else {
      signals.push({
        key: "no_website_unverified",
        label: "No website found on any source checked — verify with a quick search before pitching",
        points: 22,
      });
    }
  } else if (web.weakPlatform) {
    signals.push({
      key: "weak_website",
      label: `Only a ${web.matchedDomain} page — no real site of their own`,
      points: 22,
    });
  } else if (web.parasite) {
    signals.push({
      key: "parasite_website",
      label: `Riding a ${web.matchedDomain} profile — doesn't own their funnel`,
      points: 18,
    });
  } else {
    signals.push({
      key: "has_website",
      label: `Has an independent site (${web.host})`,
      points: -10,
    });
  }

  // ---- Review volume ------------------------------------------------------
  if (biz.reviewCount === null) {
    if (reviewPlatformChecked) {
      signals.push({
        key: "not_on_review_platforms",
        label: "Not listed on any review platform checked — flying completely under the radar",
        points: 20,
      });
    } else {
      signals.push({
        key: "review_data_unavailable",
        label: "No review platform connected — add a Yelp or Google key to grade business age",
        points: 8,
      });
    }
  } else {
    signals.push(reviewSignal(biz.reviewCount));
  }

  // ---- Profile completeness (only where a source could actually know) -----
  if (biz.photoCount !== null) {
    if (biz.photoCount === 0) {
      signals.push({ key: "no_photos", label: "No photos on their listing", points: 9 });
    } else if (biz.photoCount <= 2) {
      signals.push({ key: "few_photos", label: `Only ${biz.photoCount} photo(s) on the listing`, points: 5 });
    }
  }

  if (biz.hasHours === false) {
    signals.push({ key: "no_hours", label: "No business hours published", points: 7 });
  }

  if (biz.reviewCount !== null) {
    if (biz.rating === null) {
      signals.push({ key: "no_rating", label: "No star rating yet", points: 6 });
    } else if (biz.rating < 4.0) {
      signals.push({
        key: "low_rating",
        label: `${biz.rating.toFixed(1)}★ average — reputation work needed`,
        points: 5,
      });
    } else if (biz.rating >= 4.8 && biz.reviewCount >= 40) {
      signals.push({
        key: "strong_reputation",
        label: `${biz.rating.toFixed(1)}★ across ${biz.reviewCount} reviews — already well regarded`,
        points: -6,
      });
    }
  }

  // ---- Cross-platform footprint -------------------------------------------
  const realSources = biz.sources.filter((s) => s !== "manual");
  if (biz.checkedSources.length >= 2) {
    if (realSources.length === 1) {
      signals.push({
        key: "single_source",
        label: `Only found on ${realSources[0] === "osm" ? "OpenStreetMap" : realSources[0] === "bizdata" ? "BizData" : realSources[0] === "yelp" ? "Yelp" : "Google"} — nobody else lists them yet`,
        points: 6,
      });
    } else if (realSources.length >= 3) {
      signals.push({
        key: "everywhere",
        label: `Listed on ${realSources.length} platforms — already broadly visible`,
        points: -6,
      });
    }
  }

  // ---- Reachability -------------------------------------------------------
  if (biz.phone) {
    signals.push({ key: "has_phone", label: "Phone number published — directly callable", points: 6 });
  } else {
    signals.push({ key: "no_phone", label: "No phone listed — harder to reach", points: -8 });
  }

  // ---- Normalise against what was knowable --------------------------------
  const maxAchievable =
    6 + // phone
    (googleChecked ? 30 : 22) + // website best case
    (reviewPlatformChecked ? 24 : 8) + // reviews best case
    (googleChecked ? 9 + 7 : 0) + // photos + hours only via Google
    (reviewPlatformChecked ? 6 : 0) + // no_rating only meaningful with review data
    (biz.checkedSources.length >= 2 ? 6 : 0); // single_source bonus possible

  const raw = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.max(0, Math.min(100, Math.round((raw / maxAchievable) * 100)));

  return {
    score,
    tier: tierFor(web, biz, reviewPlatformChecked, score),
    signals,
    disqualified: false,
  };
}

/**
 * Presence tier is derived from the footprint itself rather than the score, so
 * "no website" always reads as `none` even when other signals drag the number
 * around. Unknown review counts only reach `none` when a review platform was
 * actually checked and came up empty.
 */
function tierFor(
  web: WebsiteVerdict,
  biz: ScorableBusiness,
  reviewPlatformChecked: boolean,
  score: number,
): PresenceTier {
  const effectiveReviews = biz.reviewCount ?? (reviewPlatformChecked ? 0 : 6);
  if (web.none && effectiveReviews <= 5) return "none";
  if (web.none || web.weakPlatform) return "minimal";
  if (web.parasite || (effectiveReviews <= 25 && score >= 35)) return "weak";
  return "established";
}

export const TIER_META: Record<
  PresenceTier,
  { label: string; description: string; accent: string }
> = {
  none: {
    label: "No presence",
    description: "No website and no reviews found anywhere. Cold open, highest upside.",
    accent: "emerald",
  },
  minimal: {
    label: "Minimal",
    description: "No real site of their own — a social page at best.",
    accent: "sky",
  },
  weak: {
    label: "Weak",
    description: "Some footprint, but thin or hosted on someone else's platform.",
    accent: "amber",
  },
  established: {
    label: "Established",
    description: "Already has real marketing in place. Filtered out by default.",
    accent: "zinc",
  },
};

export const TIER_ORDER: PresenceTier[] = ["none", "minimal", "weak", "established"];
