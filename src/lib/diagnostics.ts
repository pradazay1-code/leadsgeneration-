import "server-only";
import { getStore } from "./db";
import { connectionString } from "./db/postgres";
import { geocodeArea, type GeoPoint } from "./sources/geocode";
import { ALL_PROVIDERS } from "./sources";
import { QuotaExceededError } from "./quota";
import { firecrawlConfigured, search as firecrawlSearch } from "./research/firecrawl";
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

const GEOCODER_LABELS: Record<GeoPoint["via"], string> = {
  mapbox: "Mapbox",
  geoapify: "Geoapify",
  nominatim: "OpenStreetMap Nominatim",
};

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ value?: T; error?: string; quotaPaused?: string; ms: number }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  } catch (err) {
    // A spent quota is the system working as designed, not a broken source.
    if (err instanceof QuotaExceededError) {
      return { quotaPaused: err.message, ms: Date.now() - t0 };
    }
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
    return source === "mapbox"
      ? "Mapbox rejected the token. Check it's a valid public or secret token and that any URL restrictions on it allow your Vercel domain."
      : "The service refused the request (403). If you set key restrictions, they may be blocking Vercel's servers.";
  }
  if (m.includes("429") || m.includes("quota") || m.includes("rate")) {
    return "Rate limited by the provider. The keyless endpoints throttle cloud hosts aggressively — wait a few minutes. Mapbox has far more reliable capacity.";
  }
  if (m.includes("timeout") || m.includes("abort")) {
    return "The request timed out. The keyless endpoints are often slow or overloaded; Mapbox is far more reliable.";
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
    label: "Geocoder",
    status: geoOk ? "ok" : "warn",
    ms: geo.ms,
    detail: geoOk
      ? `Resolved “${probeArea}” to coordinates via ${GEOCODER_LABELS[geo.value!.via]}.`
      : "Couldn't resolve a town to coordinates, so every radius-based source is blocked. OpenStreetMap's free geocoder (Nominatim) routinely refuses cloud hosts like Vercel.",
    fix: geoOk
      ? undefined
      : "Set MAPBOX_ACCESS_TOKEN — Mapbox's geocoder is key-based and works from Vercel. GEOAPIFY_API_KEY works as a backup.",
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
          provider.id === "mapbox"
            ? "Your main discovery source. Set MAPBOX_ACCESS_TOKEN and redeploy."
            : provider.needsKey
              ? `Set ${provider.id === "yelp" ? "YELP_API_KEY" : provider.id === "geoapify" ? "GEOAPIFY_API_KEY" : provider.id === "web" ? "BRAVE_API_KEY" : "the API key"} and redeploy to enable.`
              : undefined,
      });
      continue;
    }

    if ((provider.id === "osm" || provider.id === "geoapify") && !geoOk) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "warn",
        detail: "Enabled, but it needs coordinates and the geocoder failed, so it can't run.",
        fix: "Fix the geocoder first — set MAPBOX_ACCESS_TOKEN, or GEOAPIFY_API_KEY as a backup.",
      });
      continue;
    }

    // Probe with the niche this provider actually supports.
    const niche = provider.supportsNiche("junk_removal") ? "junk_removal" : "real_estate";
    const probe = await timed(() =>
      provider.search({ niche, territory: probeTerritory as never, limit: 5 }),
    );

    if (probe.quotaPaused) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "warn",
        ms: probe.ms,
        detail: `Paused to stay inside the free tier — ${probe.quotaPaused}`,
        fix: "Nothing is broken. It resumes automatically when the period resets; raise the cap in Settings → API usage if you want more headroom.",
      });
      continue;
    }

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
            ? "Expected — OpenStreetMap has thin coverage of US service businesses, especially junk removal. Mapbox and web research are what carry the scan."
            : "Try a larger town, or widen the territory radius.",
    });
  }

  // ---- Deep research ------------------------------------------------------
  // Probed with a plain search rather than a full pass: one search credit is
  // cheap, an extraction is not, and a search proves the key and the network
  // path just as well.
  if (!firecrawlConfigured()) {
    checks.push({
      id: "firecrawl",
      label: "Deep research",
      status: "off",
      detail:
        "Not connected. This is the source that finds brand-new operators the maps have never heard of, and the only one that pulls owner names.",
      fix: "Set FIRECRAWL_API_KEY and redeploy.",
    });
  } else {
    const probe = await timed(() =>
      firecrawlSearch(`"junk removal" "${probeArea}"`, { limit: 5 }),
    );
    const hits = probe.value?.length ?? 0;
    if (hits > 0) anySourceWorked = true;
    checks.push({
      id: "firecrawl",
      label: "Deep research",
      status: probe.error ? "fail" : hits > 0 ? "ok" : "warn",
      ms: probe.ms,
      detail: probe.error
        ? `Live test search failed: ${probe.error.slice(0, 200)}`
        : hits > 0
          ? `Working — returned ${hits} result${hits === 1 ? "" : "s"} for ${probeArea}.`
          : "Reachable, but the test search returned nothing. Most often that means the credit balance is spent.",
      fix: probe.error
        ? explain("firecrawl", probe.error)
        : hits > 0
          ? undefined
          : "Check your remaining credits in the Firecrawl dashboard.",
    });
  }

  return {
    ranAt: new Date().toISOString(),
    probeArea,
    checks,
    canFindLeads: anySourceWorked,
  };
}
