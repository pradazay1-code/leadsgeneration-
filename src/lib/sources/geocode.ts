import "server-only";
import { fetchJson } from "./types";

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Which service resolved it — surfaced in diagnostics. */
  via: "geoapify" | "nominatim";
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
 * Geoapify geocoder. Preferred when a key is present: it's a real API with a
 * key, so unlike Nominatim it doesn't block cloud hosts such as Vercel — which
 * is what silently disabled every radius-based search in production.
 */
async function viaGeoapify(area: string): Promise<GeoPoint | null> {
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) return null;

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
