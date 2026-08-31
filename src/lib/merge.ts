import type { SourceId, SourceRefs } from "./types";
import { SOURCE_PRIORITY, type SourceRecord } from "./sources/types";

/**
 * A business after cross-source merging: one row per real-world operator, with
 * evidence pooled from every platform that listed it.
 */
export interface MergedBusiness {
  /** Stable dedupe key — phone-based when possible, else name+city. */
  identityKey: string;
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
}

/** Last 10 digits of a US phone number, or null when it isn't one. */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

const NAME_NOISE =
  /\b(llc|inc|co|corp|company|ltd|the|of|and|&|services?|group|team)\b|[^a-z0-9 ]/g;

export function nameCityKey(name: string, city: string | null): string {
  const n = name.toLowerCase().replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim();
  return `${n}|${(city ?? "").toLowerCase().trim()}`;
}

export function identityKeyFor(rec: { phone: string | null; name: string; city: string | null }): string {
  const p = phoneKey(rec.phone);
  return p ? `p:${p}` : `n:${nameCityKey(rec.name, rec.city)}`;
}

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
 * Identity: same normalised phone number ⇒ same business; otherwise same
 * cleaned name + city. Businesses that changed numbers between platforms can
 * slip through as two rows — acceptable, they still dedupe on re-scans.
 */
export function mergeRecords(records: SourceRecord[]): MergedBusiness[] {
  const groups = new Map<string, SourceRecord[]>();
  // Secondary index so a phone-less record can still join a phone-keyed group
  // when the name+city matches.
  const nameIndex = new Map<string, string>();

  for (const rec of records) {
    const pKey = phoneKey(rec.phone);
    const nKey = nameCityKey(rec.name, rec.city);
    let key: string;

    if (pKey) {
      key = `p:${pKey}`;
      if (!nameIndex.has(nKey)) nameIndex.set(nKey, key);
    } else {
      key = nameIndex.get(nKey) ?? `n:${nKey}`;
    }

    const group = groups.get(key);
    if (group) group.push(rec);
    else groups.set(key, [rec]);
  }

  const out: MergedBusiness[] = [];
  for (const [identityKey, group] of groups) {
    group.sort((a, b) => priorityIndex(a.source) - priorityIndex(b.source));

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
    });
  }

  return out;
}
