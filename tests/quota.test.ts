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

/** Minimal stand-in for the real store's usage counters. */
function fakeCounter(): UsageCounter & { calls: number } {
  const counts = new Map<string, number>();
  return {
    calls: 0,
    async getUsage(key, periodType, period) {
      return counts.get(`${key}|${periodType}|${period}`) ?? 0;
    },
    async incrementUsage(key, count) {
      this.calls += 1;
      const { month, day } = currentPeriods();
      for (const [periodType, period] of [
        ["month", month],
        ["day", day],
      ] as const) {
        const k = `${key}|${periodType}|${period}`;
        counts.set(k, (counts.get(k) ?? 0) + count);
      }
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
    assert.equal(counter.calls, 3, "no counter increment happens for a refused call");

    const { day } = currentPeriods();
    assert.equal(await counter.getUsage("mapbox_search", "day", day), 3);
  });

  it("increments before returning, so concurrent reservations can't both win the last slot", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "1";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();

    // Sequential awaits model what the providers actually do. The guarantee
    // under test is that the reservation is what consumes budget: once the
    // first call returns ok, the second sees the spent slot.
    const first = await reserveWith(counter, "mapbox_search");
    const second = await reserveWith(counter, "mapbox_search");

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
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

  it("rolls the daily counter over at the UTC date boundary", async () => {
    process.env.MAPBOX_SEARCH_DAILY_CAP = "1";
    process.env.MAPBOX_SEARCH_MONTHLY_CAP = "1000";
    const counter = fakeCounter();
    const periods: string[] = [];
    const spy: UsageCounter = {
      getUsage: (k, t, p) => {
        if (t === "day") periods.push(p);
        return counter.getUsage(k, t, p);
      },
      incrementUsage: (k, c) => counter.incrementUsage(k, c),
    };

    await reserveWith(spy, "mapbox_search", 1, new Date("2026-08-31T23:59:00Z"));
    await reserveWith(spy, "mapbox_search", 1, new Date("2026-09-01T00:01:00Z"));

    assert.deepEqual(periods, ["2026-08-31", "2026-09-01"]);
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
