import "server-only";
import { getStore } from "./db";
import type { LeadUpsert } from "./db/store";
import { getNiche } from "./niches";
import { isPlacesConfigured, PlacesError, textSearch, type PlaceRecord } from "./places";
import { normaliseHost, scoreBusiness } from "./scoring";
import type { NicheId, ScanRunSummary, Territory } from "./types";

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
  /** Results pulled per individual Places query. */
  perQueryLimit?: number;
  /** Cap on queries per run, protecting the Places bill on large territory lists. */
  maxQueries?: number;
}

function placeToUpsert(
  place: PlaceRecord,
  niche: NicheId,
  territoryId: string | null,
  now: string,
): LeadUpsert | null {
  const result = scoreBusiness({
    name: place.name,
    niche,
    website: place.website,
    phone: place.phone,
    rating: place.rating,
    reviewCount: place.reviewCount,
    photoCount: place.photoCount,
    hasHours: place.hasHours,
    businessStatus: place.businessStatus,
    categories: place.categories,
  });

  if (result.disqualified) return null;

  return {
    sourceId: place.sourceId,
    source: "google_places",
    name: place.name,
    niche,
    phone: place.phone,
    website: place.website,
    websiteHost: normaliseHost(place.website),
    address: place.address,
    city: place.city,
    state: place.state,
    postalCode: place.postalCode,
    lat: place.lat,
    lng: place.lng,
    mapsUrl: place.mapsUrl,
    rating: place.rating,
    reviewCount: place.reviewCount,
    photoCount: place.photoCount,
    hasHours: place.hasHours,
    businessStatus: place.businessStatus,
    categories: place.categories,
    score: result.score,
    tier: result.tier,
    signals: result.signals,
    lastSeenAt: now,
    territoryId,
  };
}

/**
 * Sweep every enabled territory, score what comes back, and persist anything
 * that clears the bar. Safe to call repeatedly — leads dedupe on their Places
 * id, and a re-scan refreshes the public data while preserving the status and
 * notes the user has set.
 */
export async function runScan(options: ScanOptions = {}): Promise<ScanRunSummary> {
  const startedAt = new Date().toISOString();
  const store = await getStore();
  const errors: string[] = [];

  if (!isPlacesConfigured()) {
    const summary: ScanRunSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      territoriesScanned: 0,
      placesInspected: 0,
      newLeads: 0,
      updatedLeads: 0,
      skipped: 0,
      errors: ["GOOGLE_PLACES_API_KEY is not set — running in demo mode, no live scan performed."],
      demoMode: true,
    };
    await store.recordScan(summary);
    return summary;
  }

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const perQueryLimit = options.perQueryLimit ?? 20;
  const maxQueries = options.maxQueries ?? 60;

  const all = await store.listTerritories();
  const targets: Territory[] = all.filter((t) => {
    if (options.territoryIds?.length) return options.territoryIds.includes(t.id);
    return t.enabled;
  });

  let placesInspected = 0;
  let skipped = 0;
  let queriesRun = 0;
  const batch = new Map<string, LeadUpsert>();
  const perTerritoryCount = new Map<string, number>();
  const now = new Date().toISOString();

  outer: for (const territory of targets) {
    const niches = options.niches?.length
      ? territory.niches.filter((n) => options.niches!.includes(n))
      : territory.niches;

    for (const niche of niches) {
      for (const template of getNiche(niche).queries) {
        if (queriesRun >= maxQueries) {
          errors.push(`Query cap of ${maxQueries} reached — remaining territories deferred.`);
          break outer;
        }
        queriesRun += 1;

        const query = template.replace("{area}", territory.area);
        try {
          const places = await textSearch(query, { limit: perQueryLimit });
          placesInspected += places.length;

          for (const place of places) {
            const upsert = placeToUpsert(place, niche, territory.id, now);
            if (!upsert || upsert.score < minScore) {
              skipped += 1;
              continue;
            }
            // Keep the highest-scoring interpretation when the same business
            // is returned by several queries.
            const prev = batch.get(upsert.sourceId);
            if (!prev || upsert.score > prev.score) batch.set(upsert.sourceId, upsert);
            perTerritoryCount.set(territory.id, (perTerritoryCount.get(territory.id) ?? 0) + 1);
          }
        } catch (err) {
          const message =
            err instanceof PlacesError
              ? `${query}: ${err.message}`
              : `${query}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(message);
          // An auth/quota failure will hit every subsequent query too — stop early.
          if (err instanceof PlacesError && (err.status === 401 || err.status === 403 || err.status === 429)) {
            break outer;
          }
        }
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
    errors,
    demoMode: false,
  };

  await store.recordScan(summary);
  return summary;
}
