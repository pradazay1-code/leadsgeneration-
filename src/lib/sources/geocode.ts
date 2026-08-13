import "server-only";
import { fetchJson } from "./types";

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
}

let lastCallAt = 0;

/**
 * Geocode a free-text area ("Norwood, MA") via Nominatim.
 *
 * Nominatim's usage policy requires an identifying User-Agent and at most one
 * request per second; callers cache the result on the territory row so each
 * territory is geocoded once, not once per scan.
 */
export async function geocodeArea(
  area: string,
): Promise<{ lat: number; lng: number } | null> {
  // Serialise calls at >=1.1s apart within this process.
  const wait = lastCallAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", area);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  try {
    const results = await fetchJson<NominatimResult[]>(url.toString(), { timeoutMs: 15000 }, "osm");
    const hit = results[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    // Geocoding is best-effort; providers that need coordinates skip instead.
    return null;
  }
}
