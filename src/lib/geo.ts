/**
 * Distance helpers for keeping results inside the territory you asked about.
 *
 * This matters more than it looks. Mapbox's `proximity` parameter — and the
 * text queries the research agent runs — only *bias* results toward a place;
 * neither restricts them. A search around Norwood can happily return a hauler
 * in Worcester, and a lead 60 km outside your service area is worse than no
 * lead at all, because you only find out after making the call.
 *
 * No runtime imports, so the rules are directly testable.
 */

const EARTH_RADIUS_KM = 6371;

export interface Point {
  lat: number;
  lng: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(lat: unknown, lng: unknown): lat is number {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return false;
  // 0,0 is in the Atlantic and is what a provider returns when it means null.
  return !(la === 0 && ln === 0);
}

export interface TerritoryBounds {
  lat: number | null;
  lng: number | null;
  radiusKm: number;
}

export interface DistanceVerdict {
  /** False only when we positively established the business is too far. */
  inRange: boolean;
  /** Distance in km, when it could be measured. */
  km: number | null;
  /** Present when out of range, phrased for the scan report. */
  reason?: string;
}

/**
 * Slack added to the stated radius.
 *
 * A territory radius is a rough intent ("around Norwood"), not a boundary, and
 * a business listed at its registered office can sit a little outside the
 * circle while still working the area. Rejecting at exactly the radius throws
 * away good leads on a rounding error.
 */
const TOLERANCE_KM = 5;

/**
 * Decide whether a business belongs to a territory.
 *
 * Unmeasurable cases return `inRange: true`. A business is only ever rejected
 * on evidence — when both ends have real coordinates and the gap genuinely
 * exceeds the radius. Sources without coordinates (research, web) are left to
 * the locality terms in their queries, since dropping everything unverifiable
 * would silently delete the sources that find the newest businesses.
 */
export function withinTerritory(
  territory: TerritoryBounds,
  business: { lat: number | null; lng: number | null },
  territoryLabel = "this territory",
): DistanceVerdict {
  if (!isValidPoint(territory.lat, territory.lng)) return { inRange: true, km: null };
  if (!isValidPoint(business.lat, business.lng)) return { inRange: true, km: null };

  const km = haversineKm(
    { lat: territory.lat as number, lng: territory.lng as number },
    { lat: business.lat as number, lng: business.lng as number },
  );

  const limit = Math.max(0, territory.radiusKm) + TOLERANCE_KM;
  if (km <= limit) return { inRange: true, km };

  return {
    inRange: false,
    km,
    reason: `${Math.round(km)} km from ${territoryLabel} — outside the ${territory.radiusKm} km radius`,
  };
}
