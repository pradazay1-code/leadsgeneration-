import "server-only";
import { fetchJson } from "./types";
import { reserve } from "../quota";
import { mapboxToken } from "./mapbox";

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Which service resolved it — surfaced in diagnostics. */
  via: "mapbox" | "geoapify" | "nominatim";
}

interface GeoapifyGeocodeResponse {
  results?: Array<{ lat?: number; lon?: number; formatted?: string }>;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
}

let lastNominatimCallAt = 0;

function valid(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/**
 * Mapbox geocoder. Tried first: it's the token the user already has, its free
 * allowance is large (100,000/month), and unlike Nominatim it doesn't refuse
 * cloud hosts.
 */
async function viaMapbox(area: string): Promise<GeoPoint | null> {
  const token = mapboxToken();
  if (!token) return null;

  const allowed = await reserve("mapbox_geocode");
  if (!allowed.ok) return null;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", area);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "1");
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "place,locality,postcode");

  interface MapboxGeocode {
    features?: Array<{ properties?: { coordinates?: { latitude?: number; longitude?: number } } }>;
  }
  const data = await fetchJson<MapboxGeocode>(url.toString(), { timeoutMs: 15000 }, "mapbox");
  const c = data.features?.[0]?.properties?.coordinates;
  const point = valid(c?.latitude, c?.longitude);
  return point ? { ...point, via: "mapbox" } : null;
}

/**
 * Geoapify geocoder. Preferred when a key is present: it's a real API with a
 * key, so unlike Nominatim it doesn't block cloud hosts such as Vercel — which
 * is what silently disabled every radius-based search in production.
 */
async function viaGeoapify(area: string): Promise<GeoPoint | null> {
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) return null;

  const allowed = await reserve("geoapify_geocode");
  if (!allowed.ok) return null;

  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", area);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("filter", "countrycode:us");
  url.searchParams.set("apiKey", key);

  const data = await fetchJson<GeoapifyGeocodeResponse>(
    url.toString(),
    { timeoutMs: 15000 },
    "geoapify",
  );
  const hit = data.results?.[0];
  const point = valid(hit?.lat, hit?.lon);
  return point ? { ...point, via: "geoapify" } : null;
}

/**
 * Nominatim fallback. Its usage policy requires an identifying User-Agent and
 * at most one request per second, and it frequently refuses datacenter IPs
 * outright — hence the Geoapify path above.
 */
async function viaNominatim(area: string): Promise<GeoPoint | null> {
  const allowed = await reserve("nominatim");
  if (!allowed.ok) return null;

  const wait = lastNominatimCallAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCallAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", area);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const results = await fetchJson<NominatimResult[]>(url.toString(), { timeoutMs: 15000 }, "osm");
  const hit = results[0];
  const point = valid(hit?.lat, hit?.lon);
  return point ? { ...point, via: "nominatim" } : null;
}

/**
 * Resolve a free-text area ("Norwood, MA") to coordinates, trying Geoapify
 * first and falling back to Nominatim. Callers cache the result on the
 * territory row, so each territory is geocoded once rather than once per scan.
 */
export async function geocodeArea(area: string): Promise<GeoPoint | null> {
  try {
    const point = await viaMapbox(area);
    if (point) return point;
  } catch {
    // Fall through to the next geocoder.
  }

  try {
    const point = await viaGeoapify(area);
    if (point) return point;
  } catch {
    // Fall through to the free geocoder.
  }

  try {
    return await viaNominatim(area);
  } catch {
    // Geocoding is best-effort; providers that need coordinates report the gap.
    return null;
  }
}
