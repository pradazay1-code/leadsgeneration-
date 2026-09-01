import "server-only";
import { getStore } from "./db";
import { connectionString } from "./db/postgres";
import { geocodeArea, type GeoPoint } from "./sources/geocode";
import { ALL_PROVIDERS } from "./sources";
import { QuotaExceededError } from "./quota";
import { firecrawlConfigured, search as firecrawlSearch } from "./research/firecrawl";
import { startResponseCapture, stopResponseCapture } from "./sources/types";
import { envReport, type EnvReport } from "./env-check";
import { buildInfo, type BuildInfo } from "./build-info";
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
  /** Which env var names the running process can actually see. */
  env: EnvReport;
  /** The commit serving this deployment. */
  build: BuildInfo;
  /**
   * Redacted samples of what each provider actually returned. A source that
   * comes back empty is otherwise indistinguishable from one being parsed
   * wrongly, and these APIs are only reachable from the deployment itself.
   */
  samples: Array<{ source: string; url: string; status: number; sample: string }>;
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
/**
 * Hard ceiling on any single probe.
 *
 * A source that can't answer in this long is a problem worth reporting, and
 * reporting it is the entire job. Generous per-provider timeouts belong in a
 * scan, which can afford to wait; a health check that waits is a health check
 * that gets killed by the platform and tells you nothing.
 */
const PROBE_TIMEOUT_MS = 8_000;

/** Whole-report ceiling, comfortably inside Vercel's 60s function limit. */
const REPORT_BUDGET_MS = 25_000;

/** Resolve with a marker instead of hanging past `ms`. */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<{ value?: T; timedOut?: true; error?: string; ms: number }> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const value = await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms + 250),
      ),
    ]);
    return { value, ms: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted || /abort|timed out/i.test(message)) {
      return { timedOut: true, ms: Date.now() - t0 };
    }
    return { error: message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDiagnostics(probeArea = "Norwood, MA"): Promise<DiagnosticsReport> {
  const checks: CheckResult[] = [];
  // Record what each provider actually sends back for the duration of the
  // probes. Always stopped in the finally below, so a normal scan never pays
  // the cost of it.
  const samples = startResponseCapture();

  // Environment and build are pure local reads and are the most valuable part
  // of this report when something is wrong — so they are captured before any
  // network call and returned even if every probe fails. Losing them to a
  // slow provider is what made this endpoint useless exactly when it mattered.
  const env = envReport();
  const build = buildInfo();

  const fallback = (): DiagnosticsReport => ({
    ranAt: new Date().toISOString(),
    probeArea,
    checks,
    canFindLeads: false,
    env,
    build,
    samples,
  });

  try {
    const report = await Promise.race([
      probeEverything(probeArea, checks, samples, env, build),
      new Promise<DiagnosticsReport>((resolve) =>
        setTimeout(() => {
          checks.push({
            id: "budget",
            label: "Health check",
            status: "warn",
            detail: `Stopped after ${REPORT_BUDGET_MS / 1000}s. Some sources hadn't answered — the results above are what finished in time.`,
            fix: "A source that slow is usually unreachable from this deployment, or the key is being rejected without a prompt response.",
          });
          resolve(fallback());
        }, REPORT_BUDGET_MS),
      ),
    ]);
    return report;
  } catch (err) {
    // Even a catastrophic failure must still hand back the environment
    // report — that is the part that tells you whether your keys registered.
    checks.push({
      id: "diagnostics",
      label: "Health check",
      status: "fail",
      detail: `The check itself failed: ${err instanceof Error ? err.message : String(err)}`,
      fix: "The environment and build details below were still read successfully.",
    });
    return fallback();
  } finally {
    stopResponseCapture();
  }
}

async function probeEverything(
  probeArea: string,
  checks: CheckResult[],
  samples: Array<{ source: string; url: string; status: number; sample: string }>,
  env: EnvReport,
  build: BuildInfo,
): Promise<DiagnosticsReport> {

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

  // Geocode once — only the radius-based sources need it.
  const geo = await withTimeout(() => geocodeArea(probeArea), PROBE_TIMEOUT_MS);
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

  // Sources that can't run at all need no network, so they're reported first
  // and excluded from the probe batch.
  const probeable = ALL_PROVIDERS.filter((provider) => {
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
      return false;
    }

    if (provider.needsCoordinates && !geoOk) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "warn",
        detail: "Enabled, but it needs coordinates and the geocoder failed, so it can't run.",
        fix: "Fix the geocoder first — set MAPBOX_ACCESS_TOKEN, or GEOAPIFY_API_KEY as a backup.",
      });
      return false;
    }
    return true;
  });

  // Probed concurrently, each under a hard timeout. Run in series with the
  // generous per-provider timeouts a scan uses, this endpoint could take over
  // ten minutes and be killed by the platform long before it answered.
  const probes = await Promise.all(
    probeable.map((provider) => {
      const niche = provider.supportsNiche("junk_removal") ? "junk_removal" : "real_estate";
      return withTimeout(
        (signal) => provider.search({ niche, territory: probeTerritory as never, limit: 5, signal }),
        PROBE_TIMEOUT_MS,
      ).then((result) => ({ provider, niche, result }));
    }),
  );

  for (const { provider, niche, result } of probes) {
    const probe = {
      ms: result.ms,
      value: result.value,
      error: result.error,
      quotaPaused: undefined as string | undefined,
    };

    // A quota block surfaces as a rejection, so it's recovered from the message.
    if (result.error && /cap reached|quota|disabled \(cap set to 0\)/i.test(result.error)) {
      probe.quotaPaused = result.error;
      probe.error = undefined;
    }

    if (result.timedOut) {
      checks.push({
        id: provider.id,
        label: provider.label,
        status: "fail",
        ms: result.ms,
        detail: `No response within ${PROBE_TIMEOUT_MS / 1000}s.`,
        fix: "Usually means this host is unreachable from your deployment, or the key is being held rather than rejected. Check the provider's status page.",
      });
      continue;
    }

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
    const probe = await withTimeout(
      (signal) => firecrawlSearch(`"junk removal" "${probeArea}"`, { limit: 5, signal }),
      PROBE_TIMEOUT_MS,
    );
    const hits = probe.value?.length ?? 0;
    if (hits > 0) anySourceWorked = true;
    checks.push({
      id: "firecrawl",
      label: "Deep research",
      status: probe.timedOut || probe.error ? "fail" : hits > 0 ? "ok" : "warn",
      ms: probe.ms,
      detail: probe.timedOut
        ? `No response within ${PROBE_TIMEOUT_MS / 1000}s.`
        : probe.error
          ? `Live test search failed: ${probe.error.slice(0, 200)}`
          : hits > 0
            ? `Working — returned ${hits} result${hits === 1 ? "" : "s"} for ${probeArea}.`
            : "Reachable, but the test search returned nothing. Most often that means the credit balance is spent.",
      fix: probe.timedOut
        ? "Unreachable from this deployment, or the request is being held rather than answered."
        : probe.error
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
    env,
    build,
    samples,
  };
}
