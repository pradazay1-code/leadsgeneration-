/**
 * Provider request-shape contracts.
 *
 * These intercept `fetch` and assert the exact request each provider builds —
 * URL, method, auth header, parameter names — against what each vendor's docs
 * specify. They cannot prove a vendor accepts the request, but they catch the
 * failure that has actually bitten this project: sending a correctly-formed
 * request to the wrong parameter name, which comes back as an empty result set
 * and looks identical to "there are no businesses here".
 *
 * They also pin the request shape, so a later edit can't quietly change it.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { mapboxProvider } from "../src/lib/sources/mapbox.ts";
import { geoapifyProvider } from "../src/lib/sources/geoapify.ts";
import { yelpProvider } from "../src/lib/sources/yelp.ts";
import { osmProvider } from "../src/lib/sources/osm.ts";
import { bizdataProvider } from "../src/lib/sources/bizdata.ts";
import { webProvider } from "../src/lib/sources/web.ts";
import { search as firecrawlSearch, extractBusiness } from "../src/lib/research/firecrawl.ts";
import { geocodeArea } from "../src/lib/sources/geocode.ts";
import type { Territory } from "../src/lib/types.ts";

interface Captured {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

let captured: Captured[] = [];
const realFetch = globalThis.fetch;

/** Records every request and answers with a harmless empty payload. */
function stubFetch(responseBody: unknown = {}) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);

    captured.push({
      url: new URL(raw),
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const TERRITORY: Territory = {
  id: "t1",
  label: "Norwood",
  area: "Norwood, MA",
  state: "MA",
  niches: ["junk_removal"],
  radiusKm: 15,
  enabled: true,
  lat: 42.1945,
  lng: -71.1995,
  createdAt: new Date().toISOString(),
  lastScannedAt: null,
  leadsFound: 0,
};

const ENV_KEYS = [
  "MAPBOX_ACCESS_TOKEN",
  "GEOAPIFY_API_KEY",
  "YELP_API_KEY",
  "BRAVE_API_KEY",
  "FIRECRAWL_API_KEY",
  "YELP_MONTHLY_CAP",
  "YELP_DAILY_CAP",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  captured = [];
  // Deliberately recognisable so an assertion failure shows what was sent.
  process.env.MAPBOX_ACCESS_TOKEN = "pk.test-mapbox-token";
  process.env.GEOAPIFY_API_KEY = "test-geoapify-key";
  process.env.YELP_API_KEY = "test-yelp-key";
  process.env.BRAVE_API_KEY = "test-brave-key";
  process.env.FIRECRAWL_API_KEY = "fc-test-firecrawl-key";
  // Yelp ships disabled; these tests are about request shape, not policy.
  process.env.YELP_MONTHLY_CAP = "1000";
  process.env.YELP_DAILY_CAP = "1000";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

const ctx = { niche: "junk_removal" as const, territory: TERRITORY, limit: 10 };

describe("Mapbox Search Box", () => {
  it("calls the forward endpoint with a free-text query and the token", async () => {
    stubFetch({ features: [] });
    await mapboxProvider.search(ctx);

    const req = captured[0];
    assert.ok(req, "no request was made");
    assert.equal(req.method, "GET");
    assert.equal(req.url.origin, "https://api.mapbox.com");
    assert.equal(
      req.url.pathname,
      "/search/searchbox/v1/forward",
      "must be /forward — /category needs a taxonomy id we'd have to guess",
    );
    // The parameter is access_token. api_key or apiKey returns 401.
    assert.equal(req.url.searchParams.get("access_token"), "pk.test-mapbox-token");
    assert.ok(req.url.searchParams.get("q"), "a free-text query is required");
    assert.equal(req.url.searchParams.get("types"), "poi", "only points of interest are businesses");
    assert.equal(
      req.url.searchParams.get("proximity"),
      "-71.1995,42.1945",
      "proximity is lng,lat — reversing it searches the wrong hemisphere",
    );
  });

  it("searches several phrasings, since operators describe themselves differently", async () => {
    stubFetch({ features: [] });
    await mapboxProvider.search(ctx);
    const queries = captured.map((c) => c.url.searchParams.get("q")).filter(Boolean);
    assert.ok(queries.length >= 2, `expected multiple queries, got ${queries.length}`);
    assert.ok(queries.some((q) => /junk/i.test(q!)));
  });

  it("never puts the token anywhere but the query string", async () => {
    stubFetch({ features: [] });
    await mapboxProvider.search(ctx);
    for (const req of captured) {
      assert.ok(!req.body?.includes("pk.test"), "token must not appear in a request body");
    }
  });
});

describe("Mapbox geocoder", () => {
  it("calls the v6 geocode endpoint with the place name", async () => {
    stubFetch({ features: [] });
    await geocodeArea("Norwood, MA");

    const req = captured[0];
    assert.equal(req.url.pathname, "/search/geocode/v6/forward");
    assert.equal(req.url.searchParams.get("q"), "Norwood, MA");
    assert.equal(req.url.searchParams.get("access_token"), "pk.test-mapbox-token");
    assert.equal(req.url.searchParams.get("limit"), "1");
  });
});

describe("Firecrawl", () => {
  it("posts a search with a bearer token and the documented body", async () => {
    stubFetch({ success: true, data: { web: [] } });
    await firecrawlSearch("junk removal Norwood", { limit: 10, location: "MA, United States" });

    const req = captured[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url.href, "https://api.firecrawl.dev/v2/search");
    assert.equal(req.headers.authorization, "Bearer fc-test-firecrawl-key");
    assert.equal(req.headers["content-type"], "application/json");

    const body = JSON.parse(req.body ?? "{}");
    assert.equal(body.query, "junk removal Norwood");
    assert.deepEqual(body.sources, ["web"], "v2 groups results by source");
    assert.equal(body.limit, 10);
    assert.equal(body.location, "MA, United States");
  });

  it("passes a recency filter through as tbs", async () => {
    stubFetch({ success: true, data: { web: [] } });
    await firecrawlSearch("new junk removal", { recency: "qdr:m" });
    const body = JSON.parse(captured[0].body ?? "{}");
    assert.equal(body.tbs, "qdr:m", "the recency filter is what biases results toward new businesses");
  });

  it("requests structured extraction in the v2 format, with the schema inside the format object", async () => {
    stubFetch({ success: true, data: { json: {} } });
    await extractBusiness("https://acmejunk.com");

    const req = captured[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url.href, "https://api.firecrawl.dev/v2/scrape");

    const body = JSON.parse(req.body ?? "{}");
    assert.equal(body.url, "https://acmejunk.com");
    assert.ok(Array.isArray(body.formats), "formats must be an array");
    const json = body.formats.find((f: { type?: string }) => f?.type === "json");
    assert.ok(json, "v2 nests the schema inside a { type: 'json' } format object");
    assert.ok(json.schema?.properties?.ownerName, "owner name is the field this exists for");
    assert.ok(json.prompt, "a prompt alongside the schema keeps the output honest");
  });

  it("reads results from data.web, the v2 response shape", async () => {
    stubFetch({
      success: true,
      data: { web: [{ url: "https://acmejunk.com", title: "Acme Junk", description: "New in town" }] },
    });
    const hits = await firecrawlSearch("junk removal");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].url, "https://acmejunk.com");
  });

  it("still reads a flat v1-style array, so an API version change degrades rather than breaks", async () => {
    stubFetch({ success: true, data: [{ url: "https://acmejunk.com", title: "Acme Junk" }] });
    const hits = await firecrawlSearch("junk removal");
    assert.equal(hits.length, 1);
  });
});

describe("Brave Search", () => {
  it("sends the subscription token as a header, not a query parameter", async () => {
    stubFetch({ web: { results: [] } });
    await webProvider.search(ctx);

    const req = captured[0];
    assert.equal(req.url.origin, "https://api.search.brave.com");
    assert.equal(req.url.pathname, "/res/v1/web/search");
    assert.equal(req.headers["x-subscription-token"], "test-brave-key");
    assert.equal(req.headers.accept, "application/json");
    assert.ok(
      !req.url.searchParams.get("key") && !req.url.searchParams.get("token"),
      "a key in the query string would be logged by every proxy in the path",
    );
    assert.ok(req.url.searchParams.get("q"));
  });
});

describe("Geoapify", () => {
  it("passes the key as apiKey and filters by circle", async () => {
    stubFetch({ features: [] });
    await geoapifyProvider.search(ctx);

    const req = captured[0];
    assert.equal(req.url.origin, "https://api.geoapify.com");
    assert.equal(req.url.searchParams.get("apiKey"), "test-geoapify-key");
    const filter = req.url.searchParams.get("filter");
    assert.ok(filter?.startsWith("circle:"), `expected a circle filter, got ${filter}`);
    assert.ok(filter?.includes("-71.1995"), "circle is lng,lat,radius-in-metres");
  });
});

describe("Yelp", () => {
  it("authenticates with a bearer token and bounds the radius to Yelp's maximum", async () => {
    stubFetch({ businesses: [] });
    await yelpProvider.search(ctx);

    const req = captured[0];
    assert.equal(req.url.origin, "https://api.yelp.com");
    assert.equal(req.headers.authorization, "Bearer test-yelp-key");
    const radius = Number(req.url.searchParams.get("radius"));
    assert.ok(radius <= 40000, "Yelp rejects a radius over 40km outright");
  });
});

describe("OpenStreetMap Overpass", () => {
  it("posts a form-encoded query bounded to the territory", async () => {
    stubFetch({ elements: [] });
    await osmProvider.search(ctx);

    const req = captured[0];
    assert.equal(req.method, "POST");
    assert.equal(req.headers["content-type"], "application/x-www-form-urlencoded");
    const decoded = decodeURIComponent(req.body ?? "");
    assert.ok(decoded.startsWith("data="), "Overpass expects the query in a data field");
    assert.ok(decoded.includes("[out:json]"), "without this the response is XML");
    assert.ok(decoded.includes("around:15000"), "radius is in metres");
  });
});

describe("BizData", () => {
  it("asks for a supported category and passes the radius in kilometres", async () => {
    stubFetch({ businesses: [] });
    // BizData only covers real estate; junk removal has no category there.
    await bizdataProvider.search({ ...ctx, niche: "real_estate" });

    const req = captured[0];
    assert.equal(req.url.pathname, "/api/businesses");
    assert.equal(req.url.searchParams.get("category"), "real_estate");
    assert.equal(req.url.searchParams.get("radius_km"), "15");
    assert.equal(req.url.searchParams.get("location"), "Norwood, MA");
  });

  it("makes no request at all for a niche it cannot serve", async () => {
    stubFetch({ businesses: [] });
    const out = await bizdataProvider.search(ctx); // junk_removal
    assert.deepEqual(out, []);
    assert.equal(captured.length, 0, "an unsupported niche must not burn a request");
  });
});

describe("every provider", () => {
  it("identifies itself with a User-Agent", async () => {
    stubFetch({ features: [], businesses: [], elements: [], web: { results: [] } });
    await mapboxProvider.search(ctx);
    await osmProvider.search(ctx);

    for (const req of captured) {
      const ua = req.headers["user-agent"];
      assert.ok(ua?.includes("LeadSignal"), "Nominatim and Overpass both require a real UA");
    }
  });
});
