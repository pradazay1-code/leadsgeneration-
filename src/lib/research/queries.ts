import type { NicheId } from "../types";

/**
 * The query plan behind the deep research pass.
 *
 * A single "junk removal Norwood MA" search returns the same ten established
 * companies every time — the ones with the SEO budget. That is precisely the
 * wrong end of the market. So the plan attacks from angles that surface
 * operators who *haven't* been optimised into the top results:
 *
 *  - launch language ("now open", "just started") catches businesses in their
 *    first months, which is the whole target,
 *  - social-first queries catch operators whose only presence is a Facebook
 *    page, who by definition have no website to rank,
 *  - hiring and marketplace posts catch working businesses that never built a
 *    web presence at all,
 *  - a recency filter on the search itself biases every angle toward pages
 *    published recently.
 *
 * Each angle carries a weight used to spend the credit budget: high-yield
 * angles run first and are the ones that survive a tight budget.
 */
export interface QueryPlanItem {
  query: string;
  /** Ordering hint — lower runs first. */
  priority: number;
  /** Restrict the search to recently published pages. */
  recency: "qdr:m" | "qdr:y" | null;
  /** What this angle is looking for, shown in the scan report. */
  angle: string;
  /**
   * True when hits are expected to be social or directory pages *about* a
   * business rather than the business's own site. Those are still valuable —
   * a business whose only hit is a Facebook page is a prime lead — but they
   * must never be scraped for "owner details", so they skip enrichment.
   */
  listingOnly?: boolean;
}

const NICHE_TERMS: Record<NicheId, { primary: string[]; wide: string[] }> = {
  junk_removal: {
    primary: ["junk removal", "junk hauling", "cleanout service"],
    wide: ["dumpster rental", "debris removal", "estate cleanout", "furniture removal"],
  },
  real_estate: {
    primary: ["real estate agent", "realtor"],
    wide: ["real estate broker", "property management", "buyers agent"],
  },
};

/** Phrases businesses use about themselves in their first year. */
const LAUNCH_PHRASES = [
  '"now open"',
  '"newly opened"',
  '"just launched"',
  '"new business"',
  '"family owned and operated" "new"',
];

/**
 * Build the plan for one territory×niche.
 *
 * `area` is free text as the user typed it ("Norwood, MA"), which is also how
 * people write it on their own websites — so it works as a literal search term.
 */
export function buildQueryPlan(niche: NicheId, area: string): QueryPlanItem[] {
  const terms = NICHE_TERMS[niche];
  const primary = terms.primary[0];
  const plan: QueryPlanItem[] = [];

  // 1. New-business language. The highest-signal angle: these are businesses
  //    telling the internet they just started.
  for (const [i, phrase] of LAUNCH_PHRASES.slice(0, 3).entries()) {
    plan.push({
      query: `${phrase} "${primary}" "${area}"`,
      priority: 10 + i,
      recency: "qdr:y",
      angle: "new business language",
    });
  }

  // 2. Social-only operators. A Facebook page and no website is exactly the
  //    profile worth calling, so these hits are kept as listings.
  plan.push({
    query: `site:facebook.com "${primary}" "${area}"`,
    priority: 20,
    recency: null,
    angle: "social-only operators",
    listingOnly: true,
  });

  // 3. The business's own site, minus the portals that dominate these terms.
  plan.push({
    query: `"${primary}" "${area}" -site:yelp.com -site:angi.com -site:thumbtack.com -site:zillow.com -site:realtor.com`,
    priority: 30,
    recency: null,
    angle: "independent websites",
  });

  // 4. Recently published pages only — catches write-ups, launch posts and
  //    new listings that the unfiltered query buries.
  plan.push({
    query: `"${primary}" "${area}"`,
    priority: 40,
    recency: "qdr:m",
    angle: "published in the last month",
  });

  // 5. Wider service terms, for operators who describe themselves differently.
  for (const [i, term] of terms.wide.slice(0, 2).entries()) {
    plan.push({
      query: `"${term}" "${area}" -site:yelp.com -site:angi.com`,
      priority: 50 + i,
      recency: "qdr:y",
      angle: "adjacent service terms",
    });
  }

  // 6. Hiring posts. A business advertising for a driver or an agent is
  //    trading and growing, whether or not it ever built a website.
  plan.push({
    query:
      niche === "junk_removal"
        ? `"${primary}" "${area}" (hiring OR "now hiring") driver`
        : `"${primary}" "${area}" ("now hiring" OR "join our team")`,
    priority: 60,
    recency: "qdr:y",
    angle: "hiring signals",
    listingOnly: true,
  });

  return plan.sort((a, b) => a.priority - b.priority);
}

/** Location hint passed to the search API, from a "Town, ST" territory. */
export function searchLocation(area: string, state: string): string {
  const st = state?.trim() || area.split(",")[1]?.trim() || "";
  return st ? `${st}, United States` : "United States";
}
