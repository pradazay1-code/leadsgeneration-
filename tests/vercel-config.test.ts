/**
 * Deployment configuration guard.
 *
 * Vercel's Hobby plan runs cron jobs at most once per day and allows at most
 * two of them. A schedule that breaks either rule is rejected at deploy time,
 * not at runtime — so the cost of getting it wrong is a failed deploy, and on
 * a plan with a tight daily deploy allowance that can cost a whole day.
 *
 * These tests fail locally in seconds instead.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

/** Hobby limits. Raise these only alongside an actual plan upgrade. */
const MAX_CRONS = 2;

/** A field naming exactly one value — no list, range, step or wildcard. */
function isSingleValue(field: string): boolean {
  return /^\d+$/.test(field);
}

/**
 * Sending hours the outreach runner enforces, and the default timezone offset
 * it interprets them in. Kept in sync with src/lib/outreach/providers.ts.
 */
const SEND_WINDOW = { startHour: 8, endHour: 19 };
const DEFAULT_UTC_OFFSET = -5;

describe("vercel.json crons", () => {
  const crons = config.crons ?? [];

  it("declares at least one cron, or nothing runs on a schedule", () => {
    assert.ok(crons.length > 0);
  });

  it("stays within the Hobby cron count", () => {
    assert.ok(
      crons.length <= MAX_CRONS,
      `${crons.length} crons declared; Hobby allows ${MAX_CRONS}`,
    );
  });

  it("fires each cron at most once a day", () => {
    for (const cron of crons) {
      const fields = cron.schedule.trim().split(/\s+/);
      assert.equal(fields.length, 5, `${cron.path}: "${cron.schedule}" is not a 5-field cron`);

      const [minute, hour] = fields;
      assert.ok(
        isSingleValue(minute),
        `${cron.path}: minute "${minute}" fires more than once an hour — Hobby rejects this`,
      );
      assert.ok(
        isSingleValue(hour),
        `${cron.path}: hour "${hour}" fires more than once a day — Hobby rejects this`,
      );
    }
  });

  it("points every cron at a route that exists", () => {
    for (const cron of crons) {
      const route = new URL(`../src/app${cron.path}/route.ts`, import.meta.url);
      assert.doesNotThrow(
        () => readFileSync(route),
        `${cron.path} has no route file — the cron would 404 daily`,
      );
    }
  });

  it("schedules outreach inside sending hours", () => {
    // The runner refuses to send outside business hours. On a once-daily
    // schedule, a run outside that window defers every step to the next day —
    // and then does the same thing tomorrow. Outreach would never send, with
    // nothing in the UI to say why.
    const sequences = crons.find((c) => c.path.includes("sequences"));
    assert.ok(sequences, "no sequences cron declared");

    const utcHour = Number(sequences.schedule.trim().split(/\s+/)[1]);
    const localHour = (utcHour + DEFAULT_UTC_OFFSET + 24) % 24;
    assert.ok(
      localHour >= SEND_WINDOW.startHour && localHour < SEND_WINDOW.endHour,
      `sequences cron runs at ${utcHour}:00 UTC = ${localHour}:00 local, outside the ${SEND_WINDOW.startHour}-${SEND_WINDOW.endHour} sending window, so nothing would ever send`,
    );
  });

  it("also lands inside sending hours on the US west coast", () => {
    // A single offset covers the whole deployment, but users set it per
    // agency; the chosen hour should work for Pacific too, not just Eastern.
    const sequences = crons.find((c) => c.path.includes("sequences"))!;
    const utcHour = Number(sequences.schedule.trim().split(/\s+/)[1]);
    const pacific = (utcHour - 8 + 24) % 24;
    assert.ok(
      pacific >= SEND_WINDOW.startHour && pacific < SEND_WINDOW.endHour,
      `${utcHour}:00 UTC is ${pacific}:00 Pacific, outside sending hours`,
    );
  });
});
