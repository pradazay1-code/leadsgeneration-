/**
 * Retry behaviour for the shared fetch wrapper.
 *
 * Run against a real local HTTP server rather than a stubbed `fetch`, so what
 * is tested is the actual code path including status handling, header parsing
 * and JSON decoding. A stub would only prove the stub agrees with itself.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SourceError, fetchJson } from "../src/lib/sources/types.ts";

/** Scripted responses, consumed one per request. */
let script: Array<{ status: number; body?: string; headers?: Record<string, string> }> = [];
let hits = 0;
let server: Server;
let base = "";

before(async () => {
  server = createServer((req, res) => {
    hits += 1;
    const next = script.shift() ?? { status: 200, body: JSON.stringify({ ok: true }) };
    if (next.status === 0) {
      // Simulate a dropped connection.
      req.destroy();
      return;
    }
    res.writeHead(next.status, { "Content-Type": "application/json", ...(next.headers ?? {}) });
    res.end(next.body ?? JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

function scriptResponses(...responses: typeof script) {
  script = responses;
  hits = 0;
}

describe("fetchJson retries", () => {
  it("returns the body on a first-try success", async () => {
    scriptResponses({ status: 200, body: JSON.stringify({ hello: "world" }) });
    const out = await fetchJson<{ hello: string }>(base, {}, "mapbox");
    assert.equal(out.hello, "world");
    assert.equal(hits, 1, "a success must not be retried");
  });

  it("recovers from a 429 and returns the eventual success", async () => {
    // Without this, one rate-limit blip benched the source for the whole run
    // and lost every result it would have returned.
    scriptResponses(
      { status: 429, body: "slow down" },
      { status: 200, body: JSON.stringify({ recovered: true }) },
    );
    const out = await fetchJson<{ recovered: boolean }>(base, {}, "mapbox");
    assert.equal(out.recovered, true);
    assert.equal(hits, 2);
  });

  it("recovers from a 500", async () => {
    scriptResponses({ status: 503 }, { status: 200, body: JSON.stringify({ ok: 1 }) });
    await fetchJson(base, {}, "mapbox");
    assert.equal(hits, 2);
  });

  it("recovers from a dropped connection", async () => {
    scriptResponses({ status: 0 }, { status: 200, body: JSON.stringify({ ok: 1 }) });
    await fetchJson(base, {}, "mapbox");
    assert.equal(hits, 2);
  });

  it("gives up after the retry budget and reports the real status", async () => {
    scriptResponses({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    await assert.rejects(
      () => fetchJson(base, {}, "mapbox"),
      (err: unknown) => {
        assert.ok(err instanceof SourceError);
        assert.equal(err.status, 500);
        return true;
      },
    );
    assert.equal(hits, 3, "the initial attempt plus two retries, and no more");
  });

  it("does not retry a 401 — that is an answer, not a blip", async () => {
    scriptResponses({ status: 401, body: "bad key" });
    await assert.rejects(() => fetchJson(base, {}, "mapbox"));
    assert.equal(hits, 1, "retrying a bad key just burns the time budget");
  });

  it("does not retry a 404", async () => {
    scriptResponses({ status: 404 });
    await assert.rejects(() => fetchJson(base, {}, "mapbox"));
    assert.equal(hits, 1);
  });

  it("honours a Retry-After header without stalling the scan", async () => {
    scriptResponses(
      { status: 429, headers: { "Retry-After": "1" } },
      { status: 200, body: JSON.stringify({ ok: 1 }) },
    );
    const started = Date.now();
    await fetchJson(base, {}, "mapbox");
    const elapsed = Date.now() - started;

    assert.equal(hits, 2);
    assert.ok(elapsed >= 900, `should have waited about a second, waited ${elapsed}ms`);
    assert.ok(elapsed < 6000, "a long Retry-After must not eat the whole scan budget");
  });

  it("can be told not to retry at all", async () => {
    scriptResponses({ status: 500 }, { status: 200 });
    await assert.rejects(() => fetchJson(base, { retries: 0 }, "mapbox"));
    assert.equal(hits, 1);
  });

  it("carries the source through to the error, so the report names it", async () => {
    scriptResponses({ status: 403, body: "nope" });
    await assert.rejects(
      () => fetchJson(base, {}, "firecrawl"),
      (err: unknown) => {
        assert.ok(err instanceof SourceError);
        assert.equal(err.source, "firecrawl");
        assert.ok(err.fatal, "403 should bench the provider for the run");
        return true;
      },
    );
  });
});
