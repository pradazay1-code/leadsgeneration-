/**
 * Health-check resilience.
 *
 * This endpoint's entire job is to answer when things are broken, so the ways
 * it can fail to answer matter more than its happy path. It was previously
 * killed by the platform whenever a provider was slow — running every probe in
 * series, with per-provider timeouts sized for a scan, multiplied by retries —
 * and took the environment report down with it, which is the part that says
 * whether the API keys registered at all.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { runDiagnostics } from "../src/lib/diagnostics.ts";
import { getStore } from "../src/lib/db/index.ts";

let server: Server;
let base = "";
/** When true the server accepts connections and never replies. */
let hang = true;

before(async () => {
  server = createServer((_req, res) => {
    if (hang) return; // socket held open, no response — the worst case
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ elements: [], businesses: [], features: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

const SAVED: Record<string, string | undefined> = {};
const KEYS = ["OVERPASS_URL", "BIZDATA_BASE_URL", "MAPBOX_ACCESS_TOKEN", "FIRECRAWL_API_KEY"];

beforeEach(async () => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  const g = globalThis as unknown as { __leadsignalMemory?: unknown };
  g.__leadsignalMemory = undefined;
  await (await getStore()).init();
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k]!;
  }
});

describe("runDiagnostics", () => {
  it("returns within the budget even when every source hangs", async () => {
    hang = true;
    // Point the keyless sources at a server that never answers.
    process.env.OVERPASS_URL = base;
    process.env.BIZDATA_BASE_URL = base;

    const started = Date.now();
    const report = await runDiagnostics("Norwood, MA");
    const elapsed = Date.now() - started;

    // Vercel kills the function at 60s. Anything close to that is a failure,
    // because the user sees nothing at all.
    assert.ok(elapsed < 30_000, `took ${elapsed}ms — the platform would have killed it`);
    assert.ok(report.checks.length > 0, "a report with no checks is not a report");
  });

  it("still reports the environment when the sources are unreachable", async () => {
    // This is the whole point. A user whose keys aren't working needs to see
    // which variables the app can read, and that requires no network at all —
    // losing it to a slow provider made the endpoint useless exactly when it
    // was needed.
    hang = true;
    process.env.OVERPASS_URL = base;
    process.env.BIZDATA_BASE_URL = base;
    process.env.MAPBOX_ACCESS_TOKEN = "pk.test-token-for-diagnostics-check";

    const report = await runDiagnostics("Norwood, MA");

    assert.ok(report.env, "environment report missing");
    assert.ok(report.env.vars.length > 0);
    const mapbox = report.env.vars.find((v) => v.name === "MAPBOX_ACCESS_TOKEN");
    assert.equal(mapbox?.present, true, "a set key must be reported as set");
    assert.ok(report.build, "build info missing");
  });

  it("names the sources that timed out rather than failing silently", async () => {
    hang = true;
    process.env.OVERPASS_URL = base;

    const report = await runDiagnostics("Norwood, MA");
    const osm = report.checks.find((c) => c.id === "osm");
    assert.ok(osm, "no check reported for OpenStreetMap");
    // Either it timed out, or it was skipped because the geocoder is
    // unreachable from here — both are reported, neither is silence.
    assert.ok(
      osm.status === "fail" || osm.status === "warn" || osm.status === "off",
      `unexpected status ${osm.status}`,
    );
    assert.ok(osm.detail.length > 0);
  });

  it("always reports the database and territories", async () => {
    hang = true;
    process.env.OVERPASS_URL = base;

    const report = await runDiagnostics("Norwood, MA");
    assert.ok(report.checks.find((c) => c.id === "database"), "database check missing");

    const territories = report.checks.find((c) => c.id === "territories");
    assert.ok(territories, "territories check missing");
    // With none configured this must be a failure with a fix — it is the most
    // common reason a scan appears to do nothing.
    assert.equal(territories.status, "fail");
    assert.match(territories.fix ?? "", /Territories page/i);
  });

  it("reports every configured source exactly once", async () => {
    hang = true;
    process.env.OVERPASS_URL = base;

    const report = await runDiagnostics("Norwood, MA");
    const ids = report.checks.map((c) => c.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(duplicates, [], `duplicated checks: ${duplicates.join(", ")}`);
  });
});
