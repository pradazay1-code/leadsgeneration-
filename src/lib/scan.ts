import "server-only";
import { getStore } from "./db";
import type { LeadUpsert } from "./db/store";
import { mergeRecords, type MergedBusiness } from "./merge";
import { geocodeArea } from "./sources/geocode";
import { SourceError, configuredProviders, type SourceRecord } from "./sources";
import { normaliseHost, scoreBusiness } from "./scoring";
import type { NicheId, ScanRunSummary, SourceId, Territory } from "./types";

/**
 * Leads below this score are noise — established operators who already have
 * what the agency sells. Overridable per run.
 */
export const DEFAULT_MIN_SCORE = 30;

export interface ScanOptions {
  /** Restrict the run to specific territories. Defaults to every enabled one. */
  territoryIds?: string[];
  /** Restrict to specific niches. Defaults to each territory's own niches. */
  niches?: NicheId[];
  minScore?: number;
  /** Results pulled per provider per territory×niche. */
  perSourceLimit?: number;
}

function toUpsert(
  biz: MergedBusiness,
  niche: NicheId,
  checkedSources: SourceId[],
  territoryId: string | null,
  now: string,
): LeadUpsert | null {
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

  if (result.disqualified) return null;

  return {
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
  };
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
  const store = await getStore();
  const errors: string[] = [];

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
      errors: ["Every data source is disabled — nothing to scan with."],
      demoMode: true,
    };
    await store.recordScan(summary);
    return summary;
  }

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const perSourceLimit = options.perSourceLimit ?? 120;

  const all = await store.listTerritories();
  const targets: Territory[] = all.filter((t) => {
    if (options.territoryIds?.length) return options.territoryIds.includes(t.id);
    return t.enabled;
  });

  // Providers that hit an auth/quota wall get benched for the rest of the run.
  const benched = new Set<SourceId>();
  const sourcesUsed = new Set<SourceId>();
  let placesInspected = 0;
  let skipped = 0;
  const batch = new Map<string, LeadUpsert>();
  const perTerritoryCount = new Map<string, number>();
  const now = new Date().toISOString();

  for (const territory of targets) {
    // The Overpass provider needs coordinates; geocode once and cache.
    let terr = territory;
    if (terr.lat === null || terr.lng === null) {
      const point = await geocodeArea(terr.area);
      if (point) {
        terr = { ...terr, lat: point.lat, lng: point.lng };
        await store.updateTerritory(terr.id, { lat: point.lat, lng: point.lng });
      } else {
        errors.push(`Couldn't geocode "${terr.area}" — OpenStreetMap radius search skipped for it.`);
      }
    }

    const niches = options.niches?.length
      ? terr.niches.filter((n) => options.niches!.includes(n))
      : terr.niches;

    for (const niche of niches) {
      const records: SourceRecord[] = [];
      const checkedSources: SourceId[] = [];

      for (const provider of providers) {
        if (benched.has(provider.id) || !provider.supportsNiche(niche)) continue;

        try {
          const found = await provider.search({
            niche,
            territory: terr,
            limit: perSourceLimit,
          });
          checkedSources.push(provider.id);
          sourcesUsed.add(provider.id);
          records.push(...found);
          placesInspected += found.length;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : `${provider.label}: ${String(err)}`;
          errors.push(`${terr.label} / ${niche}: ${message}`);
          if (err instanceof SourceError && err.fatal) {
            benched.add(provider.id);
            errors.push(`${provider.label} benched for the rest of this run (auth/quota).`);
          }
        }
      }

      for (const merged of mergeRecords(records)) {
        const upsert = toUpsert(merged, niche, checkedSources, terr.id, now);
        if (!upsert || upsert.score < minScore) {
          skipped += 1;
          continue;
        }
        // Keep the highest-scoring interpretation if two territories overlap.
        const prev = batch.get(upsert.sourceId);
        if (!prev || upsert.score > prev.score) batch.set(upsert.sourceId, upsert);
        perTerritoryCount.set(terr.id, (perTerritoryCount.get(terr.id) ?? 0) + 1);
      }
    }
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

  const summary: ScanRunSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    territoriesScanned: targets.length,
    placesInspected,
    newLeads: inserted,
    updatedLeads: updated,
    skipped,
    sourcesUsed: [...sourcesUsed],
    errors,
    demoMode: false,
  };

  await store.recordScan(summary);
  return summary;
}
