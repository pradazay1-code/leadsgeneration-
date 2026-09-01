import "server-only";
import { getStore } from "./db";
import type { LeadUpsert } from "./db/store";
import { mergeRecords, type MergedBusiness } from "./merge";
import { geocodeArea } from "./sources/geocode";
import { SourceError, configuredProviders, type SourceProvider, type SourceRecord } from "./sources";
import { WEBSITE_AUTHORITATIVE } from "./sources/types";
import { verifyWebsite } from "./sources/web";
import {
  runResearch,
  type ResearchContext,
  type ResearchResult,
  type ResearchStats,
} from "./research/agent";
import { firecrawlConfigured } from "./research/firecrawl";
import { QuotaExceededError } from "./quota";
import { normaliseHost, scoreBusiness } from "./scoring";
import { scopeIdentityKeys } from "./identity";
import { withinTerritory } from "./geo";
import type {
  NicheId,
  ScanCandidate,
  ScanRunSummary,
  SourceId,
  SourceScanStat,
  Territory,
} from "./types";

/**
 * Leads below this score are noise — established operators who already have
 * what the agency sells. Overridable per run.
 */
export const DEFAULT_MIN_SCORE = 30;

/**
 * Serverless functions get killed at the plan's ceiling (60s on Vercel Hobby).
 * The scanner watches the clock and stops cleanly with partial results saved,
 * rather than being killed mid-flight with nothing written.
 */
const DEFAULT_BUDGET_MS = 45_000;

/**
 * Slice of the run any single research pass may consume. Research is the
 * slowest stage by far (a search plus several page reads), so it gets a hard
 * sub-budget rather than being allowed to eat the whole scan.
 */
const RESEARCH_SLICE_MS = 20_000;

/**
 * Website-existence checks allowed per run.
 *
 * Each is one Brave query, from a 2,000/month free tier, and each costs about
 * a second of a 45-second budget. Small on purpose: it only runs for
 * businesses no authoritative source saw, which is a minority.
 */
const WEBSITE_CHECKS_PER_RUN = 8;

export interface ScanOptions {
  /** Restrict the run to specific territories. Defaults to every enabled one. */
  territoryIds?: string[];
  /** Restrict to specific niches. Defaults to each territory's own niches. */
  niches?: NicheId[];
  minScore?: number;
  /** Results pulled per provider per territory×niche. */
  perSourceLimit?: number;
  /** Wall-clock budget; the run stops early and saves what it has. */
  budgetMs?: number;
  /**
   * Override the provider roster. Production never passes this — it exists so
   * the pipeline can be driven end to end against stand-in providers, which is
   * the only way to test merging, scoring and persistence without depending on
   * six third-party APIs being reachable and returning what they did last week.
   */
  providers?: SourceProvider[];
  /** Override the research pass, for the same reason. */
  research?: (ctx: ResearchContext) => Promise<ResearchResult>;
}

function toUpsert(
  biz: MergedBusiness,
  niche: NicheId,
  checkedSources: SourceId[],
  territoryId: string | null,
  now: string,
): { upsert: LeadUpsert | null; reason?: string } {
  const result = scoreBusiness({
    name: biz.name,
    niche,
    website: biz.website,
    phone: biz.phone,
    rating: biz.rating,
    reviewCount: biz.reviewCount,
    photoCount: biz.photoCount,
    hasHours: biz.hasHours,
    businessStatus: biz.businessStatus,
    categories: biz.categories,
    sources: biz.sources,
    checkedSources,
    foundedYear: biz.foundedYear,
    looksNew: biz.looksNew,
  });

  if (result.disqualified) return { upsert: null, reason: result.disqualifiedReason };

  return {
    upsert: {
      sourceId: scopeIdentityKeys(niche, [biz.identityKey])[0],
      // Every key this business matched on, namespaced per niche so a hauler
      // and an agent sharing an office phone stay separate leads.
      identityKeys: scopeIdentityKeys(niche, biz.identityKeys),
      source: biz.primarySource,
      sources: biz.sources,
      sourceRefs: biz.sourceRefs,
      name: biz.name,
      niche,
      phone: biz.phone,
      email: biz.email,
      website: biz.website,
      websiteHost: normaliseHost(biz.website),
      address: biz.address,
      city: biz.city,
      state: biz.state,
      postalCode: biz.postalCode,
      lat: biz.lat,
      lng: biz.lng,
      mapsUrl: biz.mapsUrl,
      rating: biz.rating,
      reviewCount: biz.reviewCount,
      photoCount: biz.photoCount,
      hasHours: biz.hasHours,
      businessStatus: biz.businessStatus,
      categories: biz.categories,
      ownerName: biz.ownerName,
      foundedYear: biz.foundedYear,
      looksNew: biz.looksNew,
      score: result.score,
      tier: result.tier,
      signals: result.signals,
      lastSeenAt: now,
      territoryId,
    },
  };
}

/** Fold every territory's research pass into one run-level total. */
function sumResearch(all: ResearchStats[]): ResearchStats {
  return all.reduce((acc, s) => ({
    queriesRun: acc.queriesRun + s.queriesRun,
    hitsSeen: acc.hitsSeen + s.hitsSeen,
    skippedAlreadyResearched: acc.skippedAlreadyResearched + s.skippedAlreadyResearched,
    skippedKnownBusiness: acc.skippedKnownBusiness + s.skippedKnownBusiness,
    skippedAggregator: acc.skippedAggregator + s.skippedAggregator,
    pagesEnriched: acc.pagesEnriched + s.pagesEnriched,
    newBusinessHits: acc.newBusinessHits + s.newBusinessHits,
  }));
}

/** Mutable per-source tally, collapsed into SourceScanStat at the end. */
class SourceTally {
  readonly stats = new Map<SourceId, SourceScanStat>();

  get(source: SourceId): SourceScanStat {
    let s = this.stats.get(source);
    if (!s) {
      s = { source, returned: 0, queries: 0, errors: [], skipped: false };
      this.stats.set(source, s);
    }
    return s;
  }

  skip(source: SourceId, reason: string): void {
    const s = this.get(source);
    // Only mark skipped if it never actually ran.
    if (s.queries === 0) {
      s.skipped = true;
      s.skipReason = reason;
    }
  }

  toArray(): SourceScanStat[] {
    return [...this.stats.values()];
  }
}

/**
 * Sweep every enabled territory across every configured source, merge what
 * comes back per business, score it, and persist anything that clears the bar.
 *
 * Safe to call repeatedly — leads dedupe on their merged identity, and a
 * re-scan refreshes public data while preserving the status, notes, and
 * discovery date the user owns.
 */
export async function runScan(options: ScanOptions = {}): Promise<ScanRunSummary> {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const store = await getStore();
  const errors: string[] = [];
  const tally = new SourceTally();

  const providers = options.providers ?? configuredProviders();
  const research = options.research ?? runResearch;
  if (!providers.length) {
    const summary: ScanRunSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      territoriesScanned: 0,
      placesInspected: 0,
      newLeads: 0,
      updatedLeads: 0,
      skipped: 0,
      sourcesUsed: [],
      sourceStats: [],
      errors: [
        "No data source is available. Add MAPBOX_ACCESS_TOKEN and FIRECRAWL_API_KEY in your Vercel environment variables, then redeploy.",
      ],
      candidates: [],
      rejectionCounts: {},
      noSourcesConfigured: true,
    };
    await store.recordScan(summary);
    return summary;
  }

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const perSourceLimit = options.perSourceLimit ?? 60;

  const all = await store.listTerritories();
  const targets: Territory[] = all
    .filter((t) => {
      if (options.territoryIds?.length) return options.territoryIds.includes(t.id);
      return t.enabled;
    })
    // Least recently scanned first. A run stops when the time budget is spent,
    // so a fixed order means whatever sits at the end of the list is never
    // reached — not "scanned less often", never scanned at all. Rotating means
    // consecutive daily runs cover every territory in turn.
    .sort((a, b) => {
      if (options.territoryIds?.length) return 0; // Respect an explicit request.
      const at = a.lastScannedAt ? Date.parse(a.lastScannedAt) : 0;
      const bt = b.lastScannedAt ? Date.parse(b.lastScannedAt) : 0;
      return at - bt;
    });

  if (!targets.length) {
    const summary: ScanRunSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      territoriesScanned: 0,
      placesInspected: 0,
      newLeads: 0,
      updatedLeads: 0,
      skipped: 0,
      sourcesUsed: [],
      sourceStats: [],
      errors: ["No enabled territories. Add a town on the Territories page first."],
      candidates: [],
      rejectionCounts: {},
      noSourcesConfigured: false,
    };
    await store.recordScan(summary);
    return summary;
  }

  // Providers that hit an auth/quota wall get benched for the rest of the run.
  const benched = new Set<SourceId>();
  const sourcesUsed = new Set<SourceId>();
  const researchEnabled = Boolean(options.research) || firecrawlConfigured();
  /** Territories this run actually reached before the budget ran out. */
  const visited = new Set<string>();
  let websiteChecksLeft = WEBSITE_CHECKS_PER_RUN;
  let websiteChecks = 0;
  const researchStats: ResearchStats[] = [];
  let placesInspected = 0;
  let skipped = 0;
  let ranOutOfTime = false;
  const batch = new Map<string, LeadUpsert>();
  const perTerritoryCount = new Map<string, number>();
  const candidates: ScanCandidate[] = [];
  const rejectionCounts: Record<string, number> = {};
  const now = new Date().toISOString();

  const note = (c: ScanCandidate) => {
    rejectionCounts[c.outcome] = (rejectionCounts[c.outcome] ?? 0) + 1;
    // Keep a bounded readable sample rather than every row.
    if (candidates.length < 120) candidates.push(c);
  };

  outer: for (const territory of targets) {
    let terr = territory;
    // Recorded before the work rather than after, so a territory that is cut
    // off mid-way still counts as visited and the rotation moves on next run.
    visited.add(terr.id);

    // Only geocode if a provider that needs coordinates is actually going to
    // run. Yelp and the web search take a plain place name, so on a run using
    // only those, a geocoder outage must not block anything.
    const needsCoords = providers.some(
      (p) => p.needsCoordinates && !benched.has(p.id) && p.isConfigured(),
    );
    if (needsCoords && (terr.lat === null || terr.lng === null)) {
      const point = await geocodeArea(terr.area);
      if (point) {
        terr = { ...terr, lat: point.lat, lng: point.lng };
        await store.updateTerritory(terr.id, { lat: point.lat, lng: point.lng });
      } else {
        errors.push(
          `Couldn't geocode "${terr.area}" — radius searches skipped there. Set MAPBOX_ACCESS_TOKEN (or GEOAPIFY_API_KEY) for a geocoder that works from Vercel.`,
        );
      }
    }

    const niches = options.niches?.length
      ? terr.niches.filter((n) => options.niches!.includes(n))
      : terr.niches;

    for (const niche of niches) {
      const records: SourceRecord[] = [];
      const checkedSources: SourceId[] = [];

      if (Date.now() > deadline) {
        ranOutOfTime = true;
        break outer;
      }

      const runnable = providers.filter((p) => {
        if (benched.has(p.id)) return false;
        if (!p.supportsNiche(niche)) {
          tally.skip(p.id, `Doesn't cover the ${niche.replace("_", " ")} niche`);
          return false;
        }
        return true;
      });

      // Sources are queried concurrently. They're independent services, so
      // running them one after another made a territory cost the *sum* of six
      // round trips instead of the slowest one — which on a 45-second
      // serverless budget is the difference between covering every territory
      // and covering the first two. Per-provider rate limits are unaffected:
      // each provider still paces its own internal calls.
      const settled = await Promise.allSettled(
        runnable.map((p) => p.search({ niche, territory: terr, limit: perSourceLimit })),
      );

      // Results are folded in provider order, not completion order, so the
      // merge and the report stay deterministic regardless of network timing.
      settled.forEach((outcome, i) => {
        const provider = runnable[i];
        const stat = tally.get(provider.id);
        stat.queries += 1;

        if (outcome.status === "fulfilled") {
          const found = outcome.value;
          checkedSources.push(provider.id);
          stat.returned += found.length;
          if (found.length > 0) sourcesUsed.add(provider.id);
          records.push(...found);
          placesInspected += found.length;
          return;
        }

        const err = outcome.reason;
        const message = err instanceof Error ? err.message : String(err);

        // A quota block is expected behaviour, not a fault: bench the
        // provider quietly for the rest of the run and say why.
        if (err instanceof QuotaExceededError) {
          benched.add(provider.id);
          stat.skipped = stat.queries === 1;
          stat.skipReason = message;
          stat.errors.push(message);
          errors.push(`${provider.label} paused — ${message}`);
          return;
        }

        stat.errors.push(`${terr.label} / ${niche}: ${message}`);
        errors.push(`${provider.label} — ${message}`);
        if (err instanceof SourceError && err.fatal) {
          benched.add(provider.id);
          stat.errors.push("Benched for the rest of this run (auth failure).");
        }
      });

      // ---- Deep research -------------------------------------------------
      // Runs after the map sources so it can see what they already found, and
      // so its scarce credits go to businesses the maps missed rather than
      // re-confirming ones they didn't.
      if (researchEnabled && !benched.has("firecrawl") && Date.now() < deadline) {
        const stat = tally.get("firecrawl");
        stat.queries += 1;
        try {
          const found = await research({
            niche,
            territory: terr,
            limit: perSourceLimit,
            // Leave a slice of the run for merging and persistence.
            deadline: Math.min(deadline, Date.now() + RESEARCH_SLICE_MS),
          });
          checkedSources.push("firecrawl");
          stat.returned += found.records.length;
          if (found.records.length) sourcesUsed.add("firecrawl");
          records.push(...found.records);
          placesInspected += found.records.length;
          researchStats.push(found.stats);
          for (const n of found.notes) if (!errors.includes(n)) errors.push(n);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof QuotaExceededError) {
            benched.add("firecrawl");
            stat.skipped = stat.queries === 1;
            stat.skipReason = message;
            errors.push(`Deep research paused — ${message}`);
          } else {
            stat.errors.push(`${terr.label} / ${niche}: ${message}`);
            errors.push(`Deep research — ${message}`);
            if (err instanceof SourceError && err.fatal) benched.add("firecrawl");
          }
        }
      }

      const merged = mergeRecords(records);

      // ---- Website verification ------------------------------------------
      // Only for businesses no authoritative source saw. Those score +22 for
      // "no website found on the sources checked" rather than +30 for a
      // confirmed absence — a real difference, since website absence is the
      // heaviest signal and the whole pitch. One cheap search settles it.
      // Strictly budgeted: this is the scarcest API in the system.
      if (websiteChecksLeft > 0 && Date.now() < deadline) {
        const unverified = merged.filter(
          (b) => !b.website && !b.sources.some((s) => WEBSITE_AUTHORITATIVE.includes(s)),
        );
        for (const biz of unverified) {
          if (websiteChecksLeft <= 0 || Date.now() > deadline) break;
          websiteChecksLeft -= 1;
          const verdict = await verifyWebsite(biz.name, biz.city);
          if (!verdict) continue; // No key or no budget — leave it unverified.
          websiteChecks += 1;
          if (verdict.found && verdict.url) {
            biz.website = verdict.url;
          }
          // Either way the question was actually asked, so the scorer may now
          // treat the answer as evidence rather than a gap in the data.
          biz.sources = [...biz.sources, "web"];
          if (!checkedSources.includes("web")) checkedSources.push("web");
        }
      }

      for (const business of merged) {
        // Mapbox's proximity only biases results and the research queries are
        // plain text, so neither guarantees the business is actually near the
        // territory. Checked here rather than per-provider so every source is
        // held to the same boundary.
        const where = withinTerritory(terr, business, terr.label);
        if (!where.inRange) {
          skipped += 1;
          note({
            name: business.name,
            city: business.city,
            sources: business.sources,
            score: 0,
            outcome: where.reason ?? "Outside the territory",
          });
          continue;
        }

        const { upsert, reason } = toUpsert(business, niche, checkedSources, terr.id, now);

        if (!upsert) {
          skipped += 1;
          note({
            name: business.name,
            city: business.city,
            sources: business.sources,
            score: 0,
            outcome: reason ?? "Disqualified",
          });
          continue;
        }
        if (upsert.score < minScore) {
          skipped += 1;
          note({
            name: business.name,
            city: business.city,
            sources: business.sources,
            score: upsert.score,
            outcome: `Scored ${upsert.score}, below the ${minScore} cutoff — too established`,
          });
          continue;
        }
        note({
          name: business.name,
          city: business.city,
          sources: business.sources,
          score: upsert.score,
          outcome: "kept",
        });
        const prev = batch.get(upsert.sourceId);
        if (!prev || upsert.score > prev.score) batch.set(upsert.sourceId, upsert);
        perTerritoryCount.set(terr.id, (perTerritoryCount.get(terr.id) ?? 0) + 1);
      }
    }
  }

  if (ranOutOfTime) {
    errors.push(
      "Time budget reached — saved everything found so far. Run the scan again to continue, or split large territories into smaller towns.",
    );
  }

  const { inserted, updated, insertedIds } = await store.upsertLeads([...batch.values()]);

  // Seed each new lead's timeline so the CRM shows how it arrived.
  for (const id of insertedIds) {
    await store.logActivity({
      leadId: id,
      type: "discovered",
      body: "Found by the scanner",
      outcome: null,
      meta: {},
      actor: "system",
      durationMinutes: null,
    });
  }

  // Set from the actual lead count rather than accumulating this run's total.
  // Adding each time counted the same businesses again on every re-scan, so
  // the figure climbed forever and meant nothing; reading it back also repairs
  // territories whose totals were already inflated.
  const leadCounts = await store.countLeadsByTerritory();
  await Promise.all(
    targets.map((t) =>
      store.updateTerritory(t.id, {
        // Only stamp territories the run actually reached. Stamping the ones
        // it never got to would make them look freshly scanned and push them
        // to the back of the rotation, so they'd stay unscanned forever.
        ...(visited.has(t.id) ? { lastScannedAt: now } : {}),
        leadsFound: leadCounts.get(t.id) ?? 0,
      }),
    ),
  );

  // Explain a silent zero rather than leaving the user guessing.
  const totalReturned = tally.toArray().reduce((n, s) => n + s.returned, 0);
  if (totalReturned === 0 && !errors.length) {
    errors.push(
      "Every source returned zero listings for these territories. Check the town spelling (use “Town, ST”), widen the radius, or connect Mapbox for far better coverage.",
    );
  } else if (totalReturned > 0 && inserted === 0 && updated === 0) {
    errors.push(
      `Found ${totalReturned} listings but none cleared the bar — all were established businesses, franchises, or off-niche. Lower the minimum score to see them.`,
    );
  }

  const summary: ScanRunSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    territoriesScanned: targets.length,
    placesInspected,
    newLeads: inserted,
    updatedLeads: updated,
    skipped,
    sourcesUsed: [...sourcesUsed],
    sourceStats: tally.toArray(),
    errors,
    candidates,
    rejectionCounts,
    noSourcesConfigured: false,
    research: researchStats.length ? sumResearch(researchStats) : undefined,
    websiteChecks,
  };

  await store.recordScan(summary);
  return summary;
}
