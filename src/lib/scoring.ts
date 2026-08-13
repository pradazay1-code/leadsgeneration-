import { GENERIC_WEAK_DOMAINS, getNiche } from "./niches";
import type { NicheId, PresenceTier, ScoreResult, ScoreSignal } from "./types";

/**
 * Raw shape the scorer needs. Deliberately decoupled from the Places API so
 * manual entries and demo rows go through the identical pipeline.
 */
export interface ScorableBusiness {
  name: string;
  niche: NicheId;
  website: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number;
  photoCount: number;
  hasHours: boolean;
  businessStatus: string | null;
  categories: string[];
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
 * Confirms a Places result actually belongs to the niche we searched for.
 * Text Search is fuzzy — a query for "junk removal Norwood MA" happily returns
 * landscapers and storage units.
 */
export function matchesNiche(
  name: string,
  categories: string[],
  niche: NicheId,
): boolean {
  const cfg = getNiche(niche);
  const n = normaliseName(name);

  if (cfg.nameKeywords.some((kw) => n.includes(kw))) return true;

  // Category-only match is accepted when the category is specific
  // (e.g. real_estate_agency), but not for the generic catch-alls Google
  // attaches to literally every business.
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
    return { key: "reviews_0", label: "No reviews at all — brand new or invisible", points: 26 };
  if (reviewCount <= 3)
    return { key: "reviews_1_3", label: `Only ${reviewCount} review(s) — just getting started`, points: 22 };
  if (reviewCount <= 10)
    return { key: "reviews_4_10", label: `${reviewCount} reviews — still early stage`, points: 16 };
  if (reviewCount <= 25)
    return { key: "reviews_11_25", label: `${reviewCount} reviews — building momentum`, points: 9 };
  if (reviewCount <= 60)
    return { key: "reviews_26_60", label: `${reviewCount} reviews — moderately established`, points: 2 };
  if (reviewCount <= 150)
    return { key: "reviews_61_150", label: `${reviewCount} reviews — well established`, points: -12 };
  return {
    key: "reviews_150_plus",
    label: `${reviewCount} reviews — dominant local player`,
    points: -25,
  };
}

const MAX_RAW = 100;

/**
 * Turn a business into a 0-100 opportunity score plus an explainable
 * breakdown. Higher score = newer / thinner online footprint = better fit for
 * an agency selling websites, marketing and CRM.
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
        { key: "not_operational", label: `Business status is ${biz.businessStatus}`, points: 0 },
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

  // ---- Website footprint (the heaviest signal) ----------------------------
  const web = assessWebsite(biz.website, biz.niche);
  if (web.none) {
    signals.push({
      key: "no_website",
      label: "No website listed anywhere — top-priority opening",
      points: 32,
    });
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
  signals.push(reviewSignal(biz.reviewCount));

  // ---- Profile completeness ----------------------------------------------
  if (biz.photoCount === 0) {
    signals.push({ key: "no_photos", label: "No photos on their listing", points: 9 });
  } else if (biz.photoCount <= 2) {
    signals.push({ key: "few_photos", label: `Only ${biz.photoCount} photo(s) on the listing`, points: 5 });
  }

  if (!biz.hasHours) {
    signals.push({ key: "no_hours", label: "No business hours published", points: 7 });
  }

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

  // ---- Reachability -------------------------------------------------------
  if (biz.phone) {
    signals.push({ key: "has_phone", label: "Phone number published — directly callable", points: 6 });
  } else {
    signals.push({ key: "no_phone", label: "No phone listed — harder to reach", points: -8 });
  }

  const raw = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.max(0, Math.min(100, Math.round((raw / MAX_RAW) * 100)));

  return { score, tier: tierFor(score, web, biz.reviewCount), signals, disqualified: false };
}

/**
 * Presence tier is derived from the footprint itself rather than the score, so
 * "no website" always reads as `none` even when other signals drag the number
 * around.
 */
function tierFor(score: number, web: WebsiteVerdict, reviewCount: number): PresenceTier {
  if (web.none && reviewCount <= 5) return "none";
  if (web.none || web.weakPlatform) return "minimal";
  if (web.parasite || (reviewCount <= 25 && score >= 35)) return "weak";
  return "established";
}

export const TIER_META: Record<
  PresenceTier,
  { label: string; description: string; accent: string }
> = {
  none: {
    label: "No presence",
    description: "No website and almost no reviews. Cold open, highest upside.",
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
