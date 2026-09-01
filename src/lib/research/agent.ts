import "server-only";
import type { NicheId, Territory } from "../types";
import type { SourceRecord } from "../sources/types";
import { getStore } from "../db";
import type { ResearchTargetInput } from "../db/store";
import { apexDomain, identityKeysFor, isSharedHost, scopeIdentityKeys } from "../identity";
import { extractBusiness, firecrawlConfigured, search, type SearchHit } from "./firecrawl";
import { buildQueryPlan, searchLocation, type QueryPlanItem } from "./queries";
import { detectFranchise } from "../scoring";

/**
 * The deep research agent.
 *
 * Map data answers "who is listed near here". This answers the harder question
 * — "who is operating near here that the maps don't know about yet" — by
 * searching from several angles, discarding everything already known, and then
 * spending its scarce extraction budget only on the pages that survived.
 *
 * The order matters and is the point: filtering happens *before* enrichment, so
 * credits are never spent re-reading a page the agent has already read or
 * confirming a business that is already in the pipeline.
 */

export interface ResearchContext {
  niche: NicheId;
  territory: Territory;
  /** Maximum businesses to return. */
  limit: number;
  /** Wall-clock deadline for the whole pass. */
  deadline: number;
  /** Maximum pages to run paid extraction against in this pass. */
  enrichBudget?: number;
  signal?: AbortSignal;
}

export interface ResearchStats {
  queriesRun: number;
  hitsSeen: number;
  /** Dropped because this exact URL was researched in an earlier run. */
  skippedAlreadyResearched: number;
  /** Dropped because the business is already a lead. */
  skippedKnownBusiness: number;
  /** Dropped as a directory, portal or franchise page. */
  skippedAggregator: number;
  /** Pages that had structured extraction run against them. */
  pagesEnriched: number;
  /** Businesses that came back looking genuinely new. */
  newBusinessHits: number;
}

export interface ResearchResult {
  records: SourceRecord[];
  stats: ResearchStats;
  notes: string[];
}

const EMPTY_STATS: ResearchStats = {
  queriesRun: 0,
  hitsSeen: 0,
  skippedAlreadyResearched: 0,
  skippedKnownBusiness: 0,
  skippedAggregator: 0,
  pagesEnriched: 0,
  newBusinessHits: 0,
};

/** Default number of paid extractions per territory×niche. */
const DEFAULT_ENRICH_BUDGET = 6;

/**
 * Strip the SEO tail off a page title: "Acme Hauling | Junk Removal Norwood MA"
 * becomes "Acme Hauling".
 */
export function businessNameFromTitle(title: string): string | null {
  const head = title
    .split(/[|–—•·]|(?:\s-\s)/)[0]
    .replace(/\s*\b(home|homepage|official site|welcome)\b.*$/i, "")
    .replace(/^\s*(home|welcome to)\s*[-:]?\s*/i, "")
    .trim();
  if (head.length < 3 || head.length > 80) return null;
  // A "title" that's really a sentence is a blog post, not a business.
  if (head.split(/\s+/).length > 8) return null;
  return head;
}

const PHONE_RE = /\(?\b([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/;

function phoneFromText(text: string): string | null {
  const m = text.match(PHONE_RE);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null;
}

/** Launch language in a search snippet, as a cheap pre-extraction signal. */
const LAUNCH_RE =
  /\b(now open|newly opened|just (?:opened|launched|started)|grand opening|new(?:ly)? established|opening soon|under new ownership|serving .{0,30} since 20(?:2[3-9]|3\d))\b/i;

export function looksNewFromText(text: string): boolean {
  return LAUNCH_RE.test(text);
}

interface Candidate {
  hit: SearchHit;
  domain: string | null;
  angle: string;
  listingOnly: boolean;
  name: string;
  /**
   * Phone number visible in the search snippet. Free, and the strongest
   * identity signal available before deciding whether to spend on this page.
   */
  phoneHint: string | null;
  /** Launch language seen in the snippet, before any page is fetched. */
  snippetSaysNew: boolean;
}

/**
 * Turn raw search hits into candidates worth considering, dropping anything
 * that can't be a target business in the first place.
 */
function toCandidates(hits: SearchHit[], item: QueryPlanItem, niche: NicheId): Candidate[] {
  const out: Candidate[] = [];
  for (const hit of hits) {
    const name = businessNameFromTitle(hit.title);
    if (!name) continue;
    // Franchises and national brokerages are never the customer, so they're
    // dropped before they can consume any of the enrichment budget.
    if (detectFranchise(name, niche)) continue;

    const domain = apexDomain(hit.url);
    // A shared host (facebook.com, yelp.com) is only useful on the angles that
    // deliberately went looking there.
    if (!domain && !item.listingOnly) continue;

    out.push({
      hit,
      domain,
      angle: item.angle,
      listingOnly: item.listingOnly ?? false,
      name,
      phoneHint: phoneFromText(`${hit.description} ${hit.markdown ?? ""}`),
      snippetSaysNew: looksNewFromText(`${hit.title} ${hit.description}`),
    });
  }
  return out;
}

function toRecord(
  candidate: Candidate,
  territory: Territory,
  niche: NicheId,
  extracted: Awaited<ReturnType<typeof extractBusiness>> | null,
): SourceRecord {
  const { hit, domain, listingOnly } = candidate;
  const city = territory.area.split(",")[0]?.trim() || null;
  const snippetPhone = phoneFromText(`${hit.description} ${hit.markdown ?? ""}`);

  return {
    source: "firecrawl",
    // Domain-keyed where possible so the same business found again lands on
    // the same native id rather than looking like a new discovery.
    nativeId: domain ? `fc:${domain}` : `fc:${hit.url}`,
    profileUrl: hit.url,
    name: extracted?.businessName ?? candidate.name,
    phone: extracted?.phone ?? snippetPhone,
    email: extracted?.email ?? null,
    // A page on a shared host is evidence *about* a business, not a website of
    // its own — recording it as their website would mask the very gap we sell
    // against, so it stays null and the profile URL carries the link.
    website: listingOnly ? null : hit.url,
    address: null,
    city: extracted?.city ?? city,
    state: extracted?.state ?? territory.state ?? null,
    postalCode: null,
    lat: null,
    lng: null,
    rating: null,
    reviewCount: null,
    photoCount: null,
    hasHours: null,
    businessStatus: null,
    categories: [niche],
    ownerName: extracted?.ownerName ?? null,
    foundedYear: extracted?.foundedYear ?? null,
    looksNew:
      extracted?.newBusinessLanguage ?? (candidate.snippetSaysNew ? true : null),
    researchAngle: candidate.angle,
  };
}

/**
 * Run one deep research pass for a territory×niche.
 *
 * Never throws for budget reasons: an exhausted quota or a spent deadline
 * returns whatever was found so far, with a note explaining the shortfall.
 */
export async function runResearch(ctx: ResearchContext): Promise<ResearchResult> {
  const stats: ResearchStats = { ...EMPTY_STATS };
  const notes: string[] = [];

  if (!firecrawlConfigured()) {
    return { records: [], stats, notes: ["Firecrawl key not set — deep research skipped."] };
  }

  const store = await getStore();
  const { territory, niche } = ctx;
  const plan = buildQueryPlan(niche, territory.area);
  const location = searchLocation(territory.area, territory.state);

  // ---- Stage 1: discover ---------------------------------------------------
  const candidates: Candidate[] = [];
  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();

  for (const item of plan) {
    if (Date.now() > ctx.deadline) {
      notes.push("Research stopped early — time budget reached.");
      break;
    }
    if (candidates.length >= ctx.limit * 3) break;

    const hits = await search(item.query, {
      limit: 10,
      location,
      recency: item.recency,
      signal: ctx.signal,
    });
    stats.queriesRun += 1;
    stats.hitsSeen += hits.length;

    for (const candidate of toCandidates(hits, item, niche)) {
      // Within-run dedupe: one entry per URL, and one per domain so a site's
      // ten indexed pages don't become ten leads.
      if (seenUrls.has(candidate.hit.url)) continue;
      if (candidate.domain && seenDomains.has(candidate.domain)) continue;
      seenUrls.add(candidate.hit.url);
      if (candidate.domain) seenDomains.add(candidate.domain);
      candidates.push(candidate);
    }
  }

  if (!candidates.length) {
    if (stats.queriesRun === 0) notes.push("Firecrawl returned nothing — check the API key and remaining credits.");
    return { records: [], stats, notes };
  }

  // ---- Stage 2: filter, before spending anything ---------------------------
  // This is the step that keeps the engine from handing back the same
  // businesses week after week.
  const city = territory.area.split(",")[0]?.trim() || null;
  // Keys must be scoped exactly as storage scopes them, or the lookup silently
  // matches nothing and every known business reads as brand new.
  const keysFor = (c: Candidate) =>
    scopeIdentityKeys(
      niche,
      identityKeysFor({ name: c.name, phone: c.phoneHint, city, website: c.hit.url }),
    );

  const [alreadyResearched, knownBusinesses] = await Promise.all([
    store.seenResearchUrls(candidates.map((c) => c.hit.url)),
    store.resolveIdentities(candidates.flatMap(keysFor)),
  ]);

  const fresh: Candidate[] = [];
  for (const candidate of candidates) {
    if (alreadyResearched.has(candidate.hit.url)) {
      stats.skippedAlreadyResearched += 1;
      continue;
    }
    if (keysFor(candidate).some((k) => knownBusinesses.has(k))) {
      stats.skippedKnownBusiness += 1;
      continue;
    }
    if (isSharedHost(candidate.hit.url) && !candidate.listingOnly) {
      stats.skippedAggregator += 1;
      continue;
    }
    fresh.push(candidate);
  }

  if (!fresh.length) {
    notes.push(
      `All ${candidates.length} results were businesses you already have or pages already researched.`,
    );
    return { records: [], stats, notes };
  }

  // ---- Stage 3: enrich the most promising ----------------------------------
  // Snippet-level launch language decides who gets the paid read, so the
  // budget goes to the businesses most likely to actually be new.
  const ranked = [...fresh].sort((a, b) => {
    if (a.snippetSaysNew !== b.snippetSaysNew) return a.snippetSaysNew ? -1 : 1;
    // Own-domain pages carry owner details; social pages rarely do.
    if (a.listingOnly !== b.listingOnly) return a.listingOnly ? 1 : -1;
    return 0;
  });

  const enrichBudget = ctx.enrichBudget ?? DEFAULT_ENRICH_BUDGET;
  const records: SourceRecord[] = [];
  const researched: ResearchTargetInput[] = [];

  for (const candidate of ranked) {
    if (records.length >= ctx.limit) break;
    if (Date.now() > ctx.deadline) {
      notes.push("Research stopped early — time budget reached during enrichment.");
      break;
    }

    const canEnrich =
      !candidate.listingOnly && candidate.domain !== null && stats.pagesEnriched < enrichBudget;

    const extracted = canEnrich
      ? await extractBusiness(candidate.hit.url, ctx.signal)
      : null;
    if (extracted) stats.pagesEnriched += 1;

    // A parked domain or template is not a business — record the miss so the
    // page is never paid for again.
    if (extracted?.looksLikePlaceholder) {
      researched.push({
        url: candidate.hit.url,
        domain: candidate.domain ?? "",
        niche,
        outcome: "rejected",
      });
      stats.skippedAggregator += 1;
      continue;
    }

    const record = toRecord(candidate, territory, niche, extracted);
    if (record.looksNew || (record.foundedYear ?? 0) >= new Date().getUTCFullYear() - 2) {
      stats.newBusinessHits += 1;
    }
    records.push(record);
    researched.push({
      url: candidate.hit.url,
      domain: candidate.domain ?? "",
      niche,
      outcome: "lead",
    });
  }

  // Record every page considered, not only the ones that converted — the
  // rejections are what stop the next run walking the same dead ends.
  for (const candidate of ranked) {
    if (researched.some((r) => r.url === candidate.hit.url)) continue;
    researched.push({
      url: candidate.hit.url,
      domain: candidate.domain ?? "",
      niche,
      outcome: "rejected",
    });
  }
  await store.recordResearch(researched);

  if (stats.pagesEnriched === 0 && records.length > 0) {
    notes.push("Found businesses but had no extraction budget left, so owner details are missing.");
  }

  return { records, stats, notes };
}
