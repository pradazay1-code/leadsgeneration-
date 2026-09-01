/**
 * End-to-end backend tests.
 *
 * These drive the REAL `runScan` against the REAL MemoryStore. Only the
 * providers are stand-ins — everything downstream of them (merging, identity,
 * scoring, franchise rejection, quota benching, persistence, re-scan
 * behaviour) is production code.
 *
 * That boundary is deliberate. The third-party APIs are the one part that
 * can't be exercised from CI, and they're also the least likely thing to be
 * wrong: the bugs live in how their results are combined.
 *
 * Run with `npm test`.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { runScan } from "../src/lib/scan.ts";
import { getStore } from "../src/lib/db/index.ts";
import type { SourceProvider, SourceRecord } from "../src/lib/sources/types.ts";
import type { NicheId } from "../src/lib/types.ts";
import { QuotaExceededError } from "../src/lib/quota/index.ts";
import { SourceError } from "../src/lib/sources/types.ts";

/* ------------------------------------------------------------ fixtures */

/** A source record with sensible defaults, overridable per test. */
function record(over: Partial<SourceRecord> & { name: string }): SourceRecord {
  return {
    source: "mapbox",
    nativeId: over.nativeId ?? `id:${over.name}`,
    profileUrl: null,
    phone: null,
    email: null,
    website: null,
    address: null,
    city: "Norwood",
    state: "MA",
    postalCode: null,
    lat: null,
    lng: null,
    rating: null,
    reviewCount: null,
    photoCount: null,
    hasHours: null,
    businessStatus: null,
    categories: [],
    ...over,
  };
}

/** A provider that returns a fixed set of records. */
function fakeProvider(
  id: SourceProvider["id"],
  records: SourceRecord[],
  opts: { throws?: Error } = {},
): SourceProvider {
  return {
    id,
    label: `Fake ${id}`,
    needsKey: false,
    needsCoordinates: false,
    isConfigured: () => true,
    statusDetail: () => "fake",
    supportsNiche: () => true,
    async search() {
      if (opts.throws) throw opts.throws;
      return records.map((r) => ({ ...r, source: id }));
    },
  };
}

async function freshStore() {
  // The memory store hangs off globalThis so it survives module reloads; the
  // tests share one process, so each needs a clean slate. getStore() caches
  // the instance, so init() has to be re-run by hand to re-seed the default
  // pipelines the wipe just removed.
  const g = globalThis as unknown as { __leadsignalMemory?: unknown };
  g.__leadsignalMemory = undefined;
  const store = await getStore();
  await store.init();
  await store.createTerritory({
    label: "Norwood",
    area: "Norwood, MA",
    state: "MA",
    niches: ["junk_removal"] as NicheId[],
    radiusKm: 15,
    enabled: true,
  } as never);
  return store;
}

/** A brand-new one-truck operator: the ideal lead. */
const NEW_HAULER = record({
  name: "Acme Junk Removal",
  phone: "(617) 555-1234",
  website: null,
  nativeId: "mb:acme",
});

/* --------------------------------------------------------------- tests */

describe("runScan end to end", () => {
  beforeEach(async () => {
    await freshStore();
  });

  it("finds, scores and persists a lead", async () => {
    const store = await freshStore();
    const summary = await runScan({
      providers: [fakeProvider("mapbox", [NEW_HAULER])],
    });

    assert.equal(summary.newLeads, 1, summary.errors.join(" | "));
    assert.equal(summary.updatedLeads, 0);

    const page = await store.listLeads({});
    assert.equal(page.rows.length, 1);
    const lead = page.rows[0];
    assert.equal(lead.name, "Acme Junk Removal");
    assert.equal(lead.phone, "(617) 555-1234");
    assert.ok(lead.score > 0, "a business with no website should score above zero");
    assert.equal(lead.status, "new");
    assert.ok(lead.pipelineId, "new leads must land in a pipeline");
    assert.ok(lead.stageId, "new leads must land in a stage");
  });

  it("does not create a second lead when the same scan runs again", async () => {
    const store = await freshStore();
    await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });
    const second = await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });

    assert.equal(second.newLeads, 0, "a re-scan must refresh, not re-add");
    assert.equal(second.updatedLeads, 1);
    assert.equal((await store.listLeads({})).rows.length, 1);
  });

  it("does not duplicate when a later scan learns a phone number it didn't have", async () => {
    // The regression that made duplicates: the strongest identity key changes
    // between runs, so a naive canonical-key lookup misses the existing row.
    const store = await freshStore();
    const withoutPhone = record({ name: "Acme Junk Removal", nativeId: "mb:acme" });

    await runScan({ providers: [fakeProvider("mapbox", [withoutPhone])] });
    const second = await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });

    assert.equal(second.newLeads, 0, "the phone number must not make it a new business");
    const page = await store.listLeads({});
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].phone, "(617) 555-1234", "the new detail should be merged in");
  });

  /** One business, seen three ways, linked only transitively. */
  const THREE_SIGHTINGS = () => [
    // Only a phone.
    fakeProvider("mapbox", [record({ name: "Acme Junk Removal", phone: "617-555-1234" })]),
    // The phone and a domain — the link between the other two.
    fakeProvider("geoapify", [
      record({ name: "Acme Junk", phone: "(617) 555-1234", website: "https://acmejunk.com" }),
    ]),
    // Only the domain, under a different trading name.
    fakeProvider("bizdata", [
      record({ name: "Acme Hauling & Cleanouts", website: "https://www.acmejunk.com/about" }),
    ]),
  ];

  it("merges one business seen by three sources into a single lead", async () => {
    const store = await freshStore();
    // Scored at zero cutoff so this tests identity merging, not the scoring
    // policy — the two are separate concerns and are asserted separately.
    const summary = await runScan({ providers: THREE_SIGHTINGS(), minScore: 0 });

    assert.equal(summary.newLeads, 1, "three sightings, one business");
    const lead = (await store.listLeads({})).rows[0];
    assert.equal(lead.sources.length, 3, "every source that saw it should be recorded");
    assert.equal(lead.website, "https://acmejunk.com");
    assert.equal(lead.phone, "617-555-1234");
  });

  it("filters that same business out at the default cutoff, being well established", async () => {
    // Its own domain plus a presence on three platforms is the profile the
    // agency has nothing to sell to, so the default bar should reject it.
    const summary = await runScan({ providers: THREE_SIGHTINGS() });
    assert.equal(summary.newLeads, 0);
    assert.ok(summary.skipped >= 1, "and it should be reported as filtered, not silently dropped");
  });

  it("does not merge two businesses that merely share a social platform", async () => {
    const store = await freshStore();
    await runScan({
      providers: [
        fakeProvider("mapbox", [
          record({ name: "Acme Junk", website: "https://facebook.com/acme" }),
          record({ name: "Apex Hauling", website: "https://facebook.com/apex" }),
        ]),
      ],
    });
    assert.equal((await store.listLeads({})).rows.length, 2);
  });

  it("rejects franchises before they reach the pipeline", async () => {
    const store = await freshStore();
    const summary = await runScan({
      providers: [
        fakeProvider("mapbox", [
          record({ name: "1-800-GOT-JUNK Boston", phone: "617-555-0000" }),
          NEW_HAULER,
        ]),
      ],
    });

    assert.equal(summary.newLeads, 1, "only the independent operator should be kept");
    assert.ok(summary.skipped >= 1);
    const names = (await store.listLeads({})).rows.map((l) => l.name);
    assert.ok(!names.some((n) => n.includes("1-800")), "franchise must not be stored");
  });

  it("keeps a quota-exhausted provider from failing the run", async () => {
    const store = await freshStore();
    const summary = await runScan({
      providers: [
        fakeProvider("mapbox", [NEW_HAULER]),
        fakeProvider("yelp", [], { throws: new QuotaExceededError("Yelp cap reached", "yelp") }),
      ],
    });

    assert.equal(summary.newLeads, 1, "the working source still delivers");
    const yelpStat = summary.sourceStats.find((s) => s.source === "yelp");
    assert.ok(yelpStat?.skipReason?.includes("cap reached"));
    assert.ok(
      summary.errors.some((e) => /paused/i.test(e)),
      "a paused source should be reported as paused, not as an error",
    );
    assert.equal((await store.listLeads({})).rows.length, 1);
  });

  it("survives one source failing outright", async () => {
    const store = await freshStore();
    const summary = await runScan({
      providers: [
        fakeProvider("mapbox", [NEW_HAULER]),
        fakeProvider("osm", [], { throws: new SourceError("upstream exploded", "osm", 500) }),
      ],
    });

    assert.equal(summary.newLeads, 1);
    assert.ok(summary.errors.some((e) => e.includes("exploded")));
  });

  it("reports a real reason when every source returns nothing", async () => {
    const summary = await runScan({ providers: [fakeProvider("mapbox", [])] });
    assert.equal(summary.newLeads, 0);
    assert.ok(summary.errors.length > 0, "a silent zero is never acceptable");
    assert.match(summary.errors.join(" "), /zero listings|spelling|radius/i);
  });

  it("filters out an established business and says so", async () => {
    const summary = await runScan({
      providers: [
        fakeProvider("mapbox", [
          record({
            name: "Established Hauling",
            phone: "617-555-7777",
            website: "https://establishedhauling.com",
            reviewCount: 400,
            rating: 4.9,
            photoCount: 30,
            hasHours: true,
          }),
        ]),
        fakeProvider("yelp", [
          record({ name: "Established Hauling", phone: "617-555-7777", reviewCount: 400, rating: 4.9 }),
        ]),
      ],
    });

    assert.equal(summary.newLeads, 0, "a well-established operator is not a lead");
    assert.ok(summary.skipped >= 1);
    assert.ok(summary.candidates.some((c) => /below the .* cutoff/i.test(c.outcome)));
  });

  it("keeps territory lead counts accurate across repeated scans", async () => {
    // leadsFound used to accumulate every run, so re-scanning the same town
    // inflated it forever and the number stopped meaning anything.
    const store = await freshStore();
    for (let i = 0; i < 3; i += 1) {
      await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });
    }
    const [territory] = await store.listTerritories();
    assert.equal(territory.leadsFound, 1, "one business found three times is still one lead");
    assert.ok(territory.lastScannedAt);
  });

  it("logs a discovery activity for each new lead, once", async () => {
    const store = await freshStore();
    await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });
    await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });

    const lead = (await store.listLeads({})).rows[0];
    const activities = await store.listActivities(lead.id);
    const discoveries = activities.filter((a) => a.type === "discovered");
    assert.equal(discoveries.length, 1, "a refreshed lead was not re-discovered");
  });

  it("records the scan run so the history is auditable", async () => {
    const store = await freshStore();
    await runScan({ providers: [fakeProvider("mapbox", [NEW_HAULER])] });
    const runs = await store.recentScans(5);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].newLeads, 1);
    assert.ok(runs[0].sourceStats.length > 0, "per-source stats make a zero explainable");
  });
});

describe("runScan with the research pass", () => {
  it("scores a stated founding year as a strong new-business signal", async () => {
    const store = await freshStore();
    await runScan({
      providers: [fakeProvider("mapbox", [record({ name: "Fresh Start Hauling", phone: "617-555-2222" })])],
      research: async () => ({
        records: [
          record({
            source: "firecrawl",
            name: "Fresh Start Hauling",
            phone: "617-555-2222",
            nativeId: "fc:freshstart",
            ownerName: "Dana Ruiz",
            foundedYear: new Date().getUTCFullYear(),
            looksNew: true,
          }),
        ],
        stats: {
          queriesRun: 3,
          hitsSeen: 12,
          skippedAlreadyResearched: 0,
          skippedKnownBusiness: 0,
          skippedAggregator: 2,
          pagesEnriched: 1,
          newBusinessHits: 1,
        },
        notes: [],
      }),
    });

    const lead = (await store.listLeads({})).rows[0];
    assert.equal(lead.ownerName, "Dana Ruiz", "owner name must reach the lead");
    assert.equal(lead.foundedYear, new Date().getUTCFullYear());
    assert.ok(
      lead.signals.some((s) => s.key === "founded_this_year"),
      "a business founded this year should carry the newness signal",
    );
  });

  it("surfaces the research funnel on the scan summary", async () => {
    const summary = await runScan({
      providers: [fakeProvider("mapbox", [NEW_HAULER])],
      research: async () => ({
        records: [],
        stats: {
          queriesRun: 6,
          hitsSeen: 40,
          skippedAlreadyResearched: 12,
          skippedKnownBusiness: 9,
          skippedAggregator: 15,
          pagesEnriched: 4,
          newBusinessHits: 2,
        },
        notes: [],
      }),
    });

    assert.ok(summary.research, "the funnel must be reported");
    assert.equal(summary.research?.skippedKnownBusiness, 9);
    assert.equal(summary.research?.hitsSeen, 40);
  });

  it("keeps a failing research pass from sinking the scan", async () => {
    const store = await freshStore();
    const summary = await runScan({
      providers: [fakeProvider("mapbox", [NEW_HAULER])],
      research: async () => {
        throw new Error("firecrawl unreachable");
      },
    });

    assert.equal(summary.newLeads, 1, "map sources still deliver");
    assert.ok(summary.errors.some((e) => e.includes("unreachable")));
    assert.equal((await store.listLeads({})).rows.length, 1);
  });

  it("does not duplicate a business found by both a map source and research", async () => {
    const store = await freshStore();
    await runScan({
      providers: [fakeProvider("mapbox", [NEW_HAULER])],
      research: async () => ({
        records: [
          record({
            source: "firecrawl",
            name: "Acme Junk Removal LLC",
            phone: "(617) 555-1234",
            nativeId: "fc:acme",
            ownerName: "Sam Patel",
          }),
        ],
        stats: {
          queriesRun: 1,
          hitsSeen: 1,
          skippedAlreadyResearched: 0,
          skippedKnownBusiness: 0,
          skippedAggregator: 0,
          pagesEnriched: 1,
          newBusinessHits: 0,
        },
        notes: [],
      }),
    });

    const page = await store.listLeads({});
    assert.equal(page.rows.length, 1, "same phone number means same business");
    assert.equal(page.rows[0].ownerName, "Sam Patel", "research detail should enrich the lead");
  });
});
