import type { SourceId, SourceRefs } from "./types";
import { SOURCE_PRIORITY, type SourceRecord } from "./sources/types";
import { groupByIdentity, identityKeysFor } from "./identity";

/**
 * A business after cross-source merging: one row per real-world operator, with
 * evidence pooled from every platform that listed it.
 */
export interface MergedBusiness {
  /** Strongest key for this business — phone, else domain, else name+city. */
  identityKey: string;
  /**
   * Every key this business matched on. Storage records all of them, so a
   * later scan that only learns one of them still finds the same row.
   */
  identityKeys: string[];
  /** Richest platform that saw this business (per SOURCE_PRIORITY). */
  primarySource: SourceId;
  sources: SourceId[];
  sourceRefs: SourceRefs;

  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;

  /** Review-count-weighted average across platforms that rate. */
  rating: number | null;
  /** Combined review count; null when no review platform saw the business. */
  reviewCount: number | null;
  photoCount: number | null;
  hasHours: boolean | null;
  businessStatus: string | null;
  categories: string[];

  /** Owner or principal, when deep research found one. */
  ownerName: string | null;
  /** Year the business claims it started. */
  foundedYear: number | null;
  /** True when a source presented the business as newly launched. */
  looksNew: boolean | null;
  /** Which research angle surfaced it. */
  researchAngle: string | null;
}

export { phoneKey, nameCityKey, identityKeysFor } from "./identity";

function priorityIndex(source: SourceId): number {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

/** First non-null field value, scanning records in priority order. */
function pick<T>(records: SourceRecord[], get: (r: SourceRecord) => T | null): T | null {
  for (const r of records) {
    const v = get(r);
    if (v !== null && v !== undefined && v !== ("" as unknown as T)) return v;
  }
  return null;
}

/**
 * Merge every source record for one territory×niche into per-business rows.
 *
 * Two records are the same business when they share *any* identity key — a
 * phone number, a website domain, or a name+city. Matching is transitive, so a
 * map listing with only a phone and a directory hit with only a domain still
 * collapse into one row as long as something in between links them.
 */
export function mergeRecords(records: SourceRecord[]): MergedBusiness[] {
  const grouped = groupByIdentity(records, (r) =>
    identityKeysFor({ name: r.name, phone: r.phone, city: r.city, website: r.website }),
  );

  const out: MergedBusiness[] = [];
  for (const { keys, items: group } of grouped) {
    group.sort((a, b) => priorityIndex(a.source) - priorityIndex(b.source));
    const identityKey = keys[0];

    const sources = [...new Set(group.map((r) => r.source))];
    const sourceRefs: SourceRefs = {};
    for (const r of group) {
      if (!sourceRefs[r.source]) {
        sourceRefs[r.source] = { id: r.nativeId, url: r.profileUrl };
      }
    }

    // Reviews: combined total across platforms (a business reviewed in two
    // places is more established than either count alone suggests).
    const reviewed = group.filter((r) => r.reviewCount !== null);
    const reviewCount = reviewed.length
      ? reviewed.reduce((sum, r) => sum + (r.reviewCount ?? 0), 0)
      : null;

    const rated = group.filter((r) => r.rating !== null);
    let rating: number | null = null;
    if (rated.length) {
      const weights = rated.map((r) => Math.max(r.reviewCount ?? 0, 1));
      const total = weights.reduce((a, b) => a + b, 0);
      rating = rated.reduce((sum, r, i) => sum + (r.rating ?? 0) * weights[i], 0) / total;
      rating = Math.round(rating * 10) / 10;
    }

    const photoCounts = group.map((r) => r.photoCount).filter((v): v is number => v !== null);
    const hoursKnown = group.map((r) => r.hasHours).filter((v): v is boolean => v !== null);

    out.push({
      identityKey,
      identityKeys: keys,
      primarySource: group[0].source,
      sources,
      sourceRefs,
      name: group[0].name,
      phone: pick(group, (r) => r.phone),
      email: pick(group, (r) => r.email),
      website: pick(group, (r) => r.website),
      address: pick(group, (r) => r.address),
      city: pick(group, (r) => r.city),
      state: pick(group, (r) => r.state),
      postalCode: pick(group, (r) => r.postalCode),
      lat: pick(group, (r) => r.lat),
      lng: pick(group, (r) => r.lng),
      mapsUrl: sourceRefs.mapbox?.url ?? sourceRefs.web?.url ?? null,
      rating,
      reviewCount,
      photoCount: photoCounts.length ? Math.max(...photoCounts) : null,
      hasHours: hoursKnown.length ? hoursKnown.some(Boolean) : null,
      businessStatus: pick(group, (r) => r.businessStatus),
      categories: [...new Set(group.flatMap((r) => r.categories))],
      ownerName: pick(group, (r) => r.ownerName ?? null),
      foundedYear: pick(group, (r) => r.foundedYear ?? null),
      // Any source saying "new" is worth keeping; only treat it as settled
      // false when a source looked and said so.
      looksNew: group.some((r) => r.looksNew === true)
        ? true
        : group.some((r) => r.looksNew === false)
          ? false
          : null,
      researchAngle: pick(group, (r) => r.researchAngle ?? null),
    });
  }

  return out;
}
