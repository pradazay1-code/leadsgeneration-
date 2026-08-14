import "server-only";
import { getStore } from "./db";
import type { LeadUpsert } from "./db/store";
import { mergeRecords, type MergedBusiness } from "./merge";
import { geocodeArea } from "./sources/geocode";
import { SourceError, configuredProviders, type SourceRecord } from "./sources";
import { normaliseHost, scoreBusiness } from "./scoring";
import type {
  NicheId,
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
  });

  if (result.disqualified) return { upsert: null, reason: result.disqualifiedReason };

  return {
    upsert: {
      sourceId: `m:${niche}:${biz.identityKey}`,
      source: biz.primarySource,
      sources: biz.sources,
      sourceRefs: biz.sourceRefs,
      name: biz.name,
      niche,
      phone: biz.phone,
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
      score: result.score,
      tier: result.tier,
      signals: result.signals,
      lastSeenAt: now,
      territoryId,
    },
  };
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

  const providers = configuredProviders();
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
        "No data source is available. Add GOOGLE_PLACES_API_KEY (recommended) or YELP_API_KEY in your Vercel environment variables, then redeploy.",
      ],
      noSourcesConfigured: true,
    };
    await store.recordScan(summary);
    return summary;
  }

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const perSourceLimit = options.perSourceLimit ?? 60;

  const all = await store.listTerritories();
  const targets: Territory[] = all.filter((t) => {
    if (options.territoryIds?.length) return options.territoryIds.includes(t.id);
    return t.enabled;
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
      noSourcesConfigured: false,
    };
    await store.recordScan(summary);
    return summary;
  }

  // Providers that hit an auth/quota wall get benched for the rest of the run.
  const benched = new Set<SourceId>();
  const sourcesUsed = new Set<SourceId>();
  let placesInspected = 0;
  let skipped = 0;
  let ranOutOfTime = false;
  const batch = new Map<string, LeadUpsert>();
  const perTerritoryCount = new Map<string, number>();
  const now = new Date().toISOString();

  outer: for (const territory of targets) {
    let terr = territory;

    // Only geocode if a provider that needs coordinates is actually going to
    // run — Google and Yelp take a plain place name, so a Nominatim failure
    // must never block the whole scan.
    const needsCoords = providers.some(
      (p) => p.id === "osm" && !benched.has("osm") && p.isConfigured(),
    );
    if (needsCoords && (terr.lat === null || terr.lng === null)) {
      const point = await geocodeArea(terr.area);
      if (point) {
        terr = { ...terr, lat: point.lat, lng: point.lng };
        await store.updateTerritory(terr.id, { lat: point.lat, lng: point.lng });
      } else {
        tally.get("osm").errors.push(
          `Couldn't geocode "${terr.area}" (OpenStreetMap's geocoder often blocks cloud hosts). Radius search skipped for this territory.`,
        );
      }
    }

    const niches = options.niches?.length
      ? terr.niches.filter((n) => options.niches!.includes(n))
      : terr.niches;

    for (const niche of niches) {
      const records: SourceRecord[] = [];
      const checkedSources: SourceId[] = [];

      for (const provider of providers) {
        if (Date.now() > deadline) {
          ranOutOfTime = true;
          break outer;
        }
        if (benched.has(provider.id)) continue;
        if (!provider.supportsNiche(niche)) {
          tally.skip(provider.id, `Doesn't cover the ${niche.replace("_", " ")} niche`);
          continue;
        }

        const stat = tally.get(provider.id);
        stat.queries += 1;

        try {
          const found = await provider.search({
            niche,
            territory: terr,
            limit: perSourceLimit,
          });
          checkedSources.push(provider.id);
          stat.returned += found.length;
          if (found.length > 0) sourcesUsed.add(provider.id);
          records.push(...found);
          placesInspected += found.length;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          stat.errors.push(`${terr.label} / ${niche}: ${message}`);
          errors.push(`${provider.label} — ${message}`);
          if (err instanceof SourceError && err.fatal) {
            benched.add(provider.id);
            stat.errors.push("Benched for the rest of this run (auth or quota failure).");
          }
        }
      }

      for (const merged of mergeRecords(records)) {
        const { upsert } = toUpsert(merged, niche, checkedSources, terr.id, now);
        if (!upsert || upsert.score < minScore) {
          skipped += 1;
          continue;
        }
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

  const { inserted, updated } = await store.upsertLeads([...batch.values()]);

  await Promise.all(
    targets.map((t) =>
      store.updateTerritory(t.id, {
        lastScannedAt: now,
        leadsFound: t.leadsFound + (perTerritoryCount.get(t.id) ?? 0),
      }),
    ),
  );

  // Explain a silent zero rather than leaving the user guessing.
  const totalReturned = tally.toArray().reduce((n, s) => n + s.returned, 0);
  if (totalReturned === 0 && !errors.length) {
    errors.push(
      "Every source returned zero listings for these territories. Check the town spelling (use “Town, ST”), widen the radius, or connect Google Places for far better coverage.",
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
    noSourcesConfigured: false,
  };

  await store.recordScan(summary);
  return summary;
}
