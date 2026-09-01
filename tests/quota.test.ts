/**
 * Quota enforcement tests.
 *
 * These run on Node's built-in test runner with no extra dependencies:
 *
 *   npm test
 *
 * They import `limits.ts` directly, which is why that module deliberately has
 * no runtime imports — the rule that protects the API bill is testable in
 * isolation, without a database, a network, or a build step.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import {
  QUOTA_LIMITS,
  currentPeriods,
  effectiveCap,
  evaluateQuota,
  reserveWith,
  type QuotaKey,
  type UsageCounter,
} from "../src/lib/quota/limits.ts";

/**
 * Minimal stand-in for the real store's usage counters, matching the contract
 * the Postgres implementation provides: the increment is atomic and returns
 * the resulting totals.
 */
function fakeCounter(): UsageCounter & { calls: number; refunds: number } {
  const counts = new Map<string, number>();
  return {
    calls: 0,
    refunds: 0,
    async getUsage(key, periodType, period) {
      return counts.get(`${key}|${periodType}|${period}`) ?? 0;
    },
    async incrementUsage(key, count) {
      if (count < 0) this.refunds += 1;
      else this.calls += 1;
      const { month, day } = currentPeriods();
      const totals: Record<string, number> = {};
      for (const [periodType, period] of [
        ["month", month],
        ["day", day],
      ] as const) {
        const k = `${key}|${periodType}|${period}`;
        const next = Math.max(0, (counts.get(k) ?? 0) + count);
        counts.set(k, next);
        totals[periodType] = next;
      }
      return { monthly: totals.month ?? 0, daily: totals.day ?? 0 };
    },
  };
}

const ENV_KEYS = [
  "MAPBOX_SEARCH_MONTHLY_CAP",
  "MAPBOX_SEARCH_DAILY_CAP",
  "BRAVE_MONTHLY_CAP",
  "BRAVE_DAILY_CAP",
  "YELP_MONTHLY_CAP",
  "YELP_DAILY_CAP",
];

const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("cap configuration", () => {
  it("keeps every cap at or below the vendor's documented free tier", () => {
    for (const limit of Object.values(QUOTA_LIMITS)) {
      const { monthly, daily } = limit.cap;
      if (limit.freeTier.monthly !== undefined && monthly !== undefined) {
        assert.ok(
          monthly <= limit.freeTier.monthly,
          `${limit.key} monthly cap ${monthly} exceeds free tier ${limit.freeTier.monthly}`,
        );
      }
      if (limit.freeTier.daily !== undefined && daily !== undefined) {
        assert.ok(
          daily <= limit.freeTier.daily,
          `${limit.key} daily cap ${daily} exceeds free tier ${limit.freeTier.daily}`,
        );
      }
    }
  });

  it("bounds every quota — none may run unlimited", () => {
    for (const limit of Object.values(QUOTA_LIMITS)) {
      assert.ok(
        limit.cap.monthly !== undefined || limit.cap.daily !== undefined,
        `${limit.key} has no cap at all`,
      );
    }
  });

  it("keeps the two Firecrawl caps inside their single shared credit pool", () => {
    // Firecrawl bills search and scrape from one balance, so capping each
    // under the allowance separately would still allow double the spend.
    const pool = QUOTA_LIMITS.firecrawl_search.freeTier.monthly!;
    const combined =
      QUOTA_LIMITS.firecrawl_search.cap.monthly! + QUOTA_LIMITS.firecrawl_scrape.cap.monthly!;
    assert.ok(combined <= pool, `combined Firecrawl cap ${combined} exceeds the ${pool}-credit pool`);
  });

  it("keeps Yelp off by default, since it bills once the trial ends", () => {
    const cap = effectiveCap("yelp");
    assert.equal(cap.monthly, 0);
    const decision = evaluateQuota("yelp", { monthly: 0, daily: 0 }, cap);
    assert.equal(decision.ok, false);
    assert.match(decision.reason ?? "", /disabled/i);
  });

  it("lets an env var override a cap", () => {
    process.env.BRAVE_MONTHLY_CAP = "10";
    assert.equal(effectiveCap("brave_search").monthly, 10);
  });

  it("ignores a malformed env override rather than running uncapped", () => {
    process.env.BRAVE_MONTHLY_CAP = "not-a-number";
    assert.equal(
      effectiveCap("brave_search").monthly,
      QUOTA_LIMITS.brave_search.cap.monthly,
    );
  });
});

describe("evaluateQuota", () => {
  const cap = { monthly: 100, daily: 10 };

  it("allows a call strictly inside both caps", () => {
    assert.equal(evaluateQuota("mapbox_search", { monthly: 5, daily: 5 }, cap).ok, true);
  });

  it("allows the call that lands exactly on the cap", () => {
    assert.equal(evaluateQuota("mapbox_search", { monthly: 99, daily: 9 }, cap).ok, true);
  });

  it("refuses the call that would cross the daily cap", () => {
    const d = evaluateQuota("mapbox_search", { monthly: 0, daily: 10 }, cap);
    assert.equal(d.ok, false);
    assert.match(d.reason ?? "", /daily cap reached \(10\/10\)/);
  });

  it("refuses the call that would cross the monthly cap", () => {
    const d = evaluateQuota("mapbox_search", { monthly: 100, daily: 0 }, cap);
    assert.equal(d.ok, false);
    assert.match(d.reason ?? "", /monthly cap reached \(100\/100\)/);
  });

  it("refuses a batch that would overshoot even when the current total fits", () => {
    const d = evaluateQuota("mapbox_search", { monthly: 0, daily: 8 }, cap, 5);
    assert.equal(d.ok, false, "8 + 5 exceeds the daily cap of 10");
  });

  it("reports the monthly cap first when both are exhausted", () => {
    const d = evaluateQuota("mapbox_search", { monthly: 100, daily: 10 }, cap);
    assert.match(d.reason ?? "", /monthly/);
  });
});

describe("reserveWith", () => {
  it("never lets usage exceed the cap, however many calls are attempted", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "3";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();

    const results = [];
    for (let i = 0; i < 10; i += 1) {
      results.push(await reserveWith(counter, "mapbox_search"));
    }

    const granted = results.filter((r) => r.ok).length;
    assert.equal(granted, 3, "exactly the capped number of calls may proceed");

    const { day } = currentPeriods();
    assert.equal(
      await counter.getUsage("mapbox_search", "day", day),
      3,
      "a refused reservation must leave no residue on the counter",
    );
  });

  it("holds the cap when every reservation is made concurrently", async () => {
    // The real race: a cron scan and a manual scan reserving at the same
    // moment. Read-then-increment let both read the same under-cap total and
    // both proceed; incrementing first and judging the returned value is what
    // makes the cap hold.
    process.env.MAPBOX_SEARCH_DAILY_CAP = "5";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();

    const results = await Promise.all(
      Array.from({ length: 25 }, () => reserveWith(counter, "mapbox_search")),
    );

    assert.equal(results.filter((r) => r.ok).length, 5, "exactly the cap, no matter the concurrency");
    const { day } = currentPeriods();
    assert.equal(await counter.getUsage("mapbox_search", "day", day), 5);
  });

  it("refunds the reservation it just made when the call would breach the cap", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "1";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();

    assert.equal((await reserveWith(counter, "mapbox_search")).ok, true);
    assert.equal((await reserveWith(counter, "mapbox_search")).ok, false);

    assert.equal(counter.refunds, 1, "the refused reservation is given back");
    const { day } = currentPeriods();
    assert.equal(await counter.getUsage("mapbox_search", "day", day), 1);
  });

  it("charges the requested count, not one per call", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "10";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();

    assert.equal((await reserveWith(counter, "mapbox_search", 7)).ok, true);
    assert.equal((await reserveWith(counter, "mapbox_search", 7)).ok, false, "7 + 7 > 10");
    assert.equal((await reserveWith(counter, "mapbox_search", 3)).ok, true, "7 + 3 == 10");

    const { day } = currentPeriods();
    assert.equal(await counter.getUsage("mapbox_search", "day", day), 10);
  });

  it("counts monthly and daily usage separately", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "5";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "5";
    const counter = fakeCounter();

    await reserveWith(counter, "mapbox_search", 2);
    const { month, day } = currentPeriods();
    assert.equal(await counter.getUsage("mapbox_search", "month", month), 2);
    assert.equal(await counter.getUsage("mapbox_search", "day", day), 2);
  });

  it("refuses every disabled-quota call without touching the counter", async () => {
    const counter = fakeCounter();
    const decision = await reserveWith(counter, "yelp");
    assert.equal(decision.ok, false);
    assert.equal(counter.calls, 0);
  });

  it("keeps a refund from driving a counter negative", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "2";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();

    for (let i = 0; i < 6; i += 1) await reserveWith(counter, "mapbox_search");

    const { day, month } = currentPeriods();
    assert.equal(await counter.getUsage("mapbox_search", "day", day), 2);
    assert.ok((await counter.getUsage("mapbox_search", "month", month)) >= 0);
  });
});

describe("currentPeriods", () => {
  it("rolls the daily key over at the UTC date boundary", () => {
    assert.deepEqual(currentPeriods(new Date("2026-08-31T23:59:00Z")), {
      month: "2026-08",
      day: "2026-08-31",
    });
    assert.deepEqual(currentPeriods(new Date("2026-09-01T00:01:00Z")), {
      month: "2026-09",
      day: "2026-09-01",
    });
  });
});

describe("quota keys", () => {
  it("gives every key a label and a free-tier note the settings page can show", () => {
    for (const [key, limit] of Object.entries(QUOTA_LIMITS) as [QuotaKey, (typeof QUOTA_LIMITS)[QuotaKey]][]) {
      assert.equal(limit.key, key, "the record key and the limit's own key must agree");
      assert.ok(limit.label.length > 0, `${key} has no label`);
      assert.ok(limit.freeTier.note.length > 0, `${key} has no free-tier note`);
    }
  });
});
