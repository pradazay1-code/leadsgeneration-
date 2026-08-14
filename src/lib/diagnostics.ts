import "server-only";
import { getStore } from "./db";
import { connectionString } from "./db/postgres";
import { geocodeArea } from "./sources/geocode";
import { ALL_PROVIDERS } from "./sources";
import type { SourceId } from "./types";

export interface CheckResult {
  id: string;
  label: string;
  /** ok = working. warn = configured but returned nothing. fail = broken. off = not configured. */
  status: "ok" | "warn" | "fail" | "off";
  detail: string;
  /** Round-trip time in ms, when the check made a network call. */
  ms?: number;
  /** What to do about it, when something needs doing. */
  fix?: string;
}

export interface DiagnosticsReport {
  ranAt: string;
  /** Test locality used for the live source probes. */
  probeArea: string;
  checks: CheckResult[];
  /** True when at least one source returned real listings. */
  canFindLeads: boolean;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

/** Short, actionable version of a provider error. */
function explain(source: SourceId, message: string): string {
  const m = message.toLowerCase();
  if (m.includes("401") || m.includes("unauthorized")) {
    return "The API key was rejected. Check it's pasted correctly and, on Vercel, that you redeployed after adding it.";
  }
  if (m.includes("403")) {
    return source === "google_places"
      ? "Google rejected the key. Enable “Places API (New)” in your Google Cloud project, attach a billing account, and check any key restrictions."
      : "The service refused the request (403). If you set key restrictions, they may be blocking Vercel's servers.";
  }
  if (m.includes("429") || m.includes("quota") || m.includes("rate")) {
    return "Rate limited or out of quota. Free endpoints throttle cloud hosts aggressively — wait a few minutes, or connect Google Places for reliable capacity.";
  }
  if (m.includes("timeout") || m.includes("abort")) {
    return "The request timed out. Free endpoints are often slow or overloaded; Google Places is far more reliable.";
  }
  if (m.includes("enotfound") || m.includes("fetch failed") || m.includes("econnrefused")) {
    return "Couldn't reach the service at all — it may be down or blocking this host.";
  }
  return message.slice(0, 300);
}

/**
 * Live end-to-end health check. Every source is probed with a real query
 * against a real town, so "why did my scan return nothing" always has a
 * concrete answer.
 */
export async function runDiagnostics(probeArea = "Norwood, MA"): Promise<DiagnosticsReport> {
  const checks: CheckResult[] = [];

  /* ---------------------------------------------------------- storage --- */
  const store = await getStore();
  if (store.kind === "postgres") {
    checks.push({
      id: "database",
      label: "Database",
      status: "ok",
      detail: "Postgres connected. Leads, notes and territories persist across deploys and devices.",
    });
  } else {
    checks.push({
      id: "database",
      label: "Database",
      status: "fail",
      detail: connectionString()
        ? "A connection string is set but the database couldn't be reached, so the app fell back to memory. Scanned leads will disappear."
        : "No database connected. Leads are held in memory only — on Vercel each request may hit a different server, so scanned leads appear to vanish immediately.",
      fix: "Vercel → your project → Storage → Create Database → Postgres. POSTGRES_URL is injected automatically; redeploy after creating it.",
    });
  }

  /* -------------------------------------------------------- territories --- */
  const territories = await store.listTerritories();
  const enabled = territories.filter((t) => t.enabled);
  checks.push({
    id: "territories",
    label: "Territories",
    status: enabled.length ? "ok" : "fail",
    detail: enabled.length
      ? `${enabled.length} enabled territor${enabled.length === 1 ? "y" : "ies"} will be swept.`
      : "No enabled territories, so a scan has nothing to search.",
    fix: enabled.length ? undefined : "Add a town on the Territories page, e.g. “Norwood, MA”.",
  });

  /* ------------------------------------------------------------ sources --- */
  const probeTerritory = {
    id: "probe",
    label: "Diagnostics probe",
    area: probeArea,
    state: probeArea.match(/,\s*([A-Za-z]{2})\s*$/)?.[1]?.toUpperCase() ?? "",
    niches: ["junk_removal", "real_estate"] as const,
    radiusKm: 15,
    lat: null as number | null,
    lng: null as number | null,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastScannedAt: null,
    leadsFound: 0,
  };

  // Geocode once — only the Overpass source needs it.
  const geo = await timed(() => geocodeArea(probeArea));
  const geoOk = Boolean(geo.value);
  if (geoOk) {
    probeTerritory.lat = geo.value!.lat;
    probeTerritory.lng = geo.value!.lng;
  }
  checks.push({
    id: "geocoder",
    label: "Geocoder (OpenStreetMap Nominatim)",
    status: geoOk ? "ok" : "warn",
    ms: geo.ms,
    detail: geoOk
      ? `Resolved “${probeArea}” to coordinates.`
      : "Couldn't resolve a town to coordinates. Nominatim commonly blocks cloud hosts like Vercel.",
    fix: geoOk
      ? undefined
      : "Only the OpenStreetMap radius search needs this. Google Places and Yelp search by place name, so they're unaffected.",
  });

  let anySourceWorked = false;

  for (const provider of ALL_PROVIDERS) {
    if (!provider.isConfigured()) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "off",
        detail: provider.statusDetail(),
        fix:
          provider.id === "google_places"
            ? "Strongly recommended — this is the source with real coverage of junk removal and real estate. Set GOOGLE_PLACES_API_KEY and redeploy."
            : provider.needsKey
              ? `Set ${provider.id === "yelp" ? "YELP_API_KEY" : "the API key"} and redeploy to enable.`
              : undefined,
      });
      continue;
    }

    if (provider.id === "osm" && !geoOk) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "warn",
        detail: "Enabled, but it needs coordinates and the geocoder failed, so it can't run.",
        fix: "Use Google Places instead — it doesn't need geocoding.",
      });
      continue;
    }

    // Probe with the niche this provider actually supports.
    const niche = provider.supportsNiche("junk_removal") ? "junk_removal" : "real_estate";
    const probe = await timed(() =>
      provider.search({ niche, territory: probeTerritory as never, limit: 5 }),
    );

    if (probe.error) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "fail",
        ms: probe.ms,
        detail: `Live test query failed: ${probe.error.slice(0, 200)}`,
        fix: explain(provider.id, probe.error),
      });
      continue;
    }

    const count = probe.value?.length ?? 0;
    if (count > 0) anySourceWorked = true;
    checks.push({
      id: provider.id,
      label: provider.label,
      status: count > 0 ? "ok" : "warn",
      ms: probe.ms,
      detail:
        count > 0
          ? `Working — returned ${count} ${niche.replace("_", " ")} listing${count === 1 ? "" : "s"} near ${probeArea}.`
          : `Reachable, but returned no ${niche.replace("_", " ")} listings near ${probeArea}.`,
      fix:
        count > 0
          ? undefined
          : provider.id === "osm" || provider.id === "bizdata"
            ? "Expected — OpenStreetMap has thin coverage of US service businesses, especially junk removal. Google Places is the fix."
            : "Try a larger town, or widen the territory radius.",
    });
  }

  return {
    ranAt: new Date().toISOString(),
    probeArea,
    checks,
    canFindLeads: anySourceWorked,
  };
}
