/**
 * Redaction tests.
 *
 * The diagnostic report exists to be copied out of the app and pasted
 * somewhere else. That makes redaction safety-critical: a leaked key here is
 * worse than not having the feature at all, because the leak is invisible and
 * the user believes it was handled.
 *
 * Every real key format the app accepts is covered.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redact } from "../src/lib/sources/types.ts";

/** Shapes matching what each vendor actually issues. */
const MAPBOX_PUBLIC = "pk.eyJ1IjoidGVzdCIsImEiOiJjbGFiY2RlZmcifQ.AbCdEfGhIjKlMnOpQr";
const MAPBOX_SECRET = "sk.eyJ1IjoidGVzdCIsImEiOiJjbGFiY2RlZmcifQ.ZyXwVuTsRqPoNmLkJi";
const FIRECRAWL = "fc-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const GENERIC = "8f14e45fceea167a5a36dedd4bea2543";

describe("redact", () => {
  it("strips a Mapbox token from a query string", () => {
    const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=junk&access_token=${MAPBOX_PUBLIC}&limit=10`;
    const out = redact(url);
    assert.ok(!out.includes(MAPBOX_PUBLIC), "the token survived redaction");
    assert.ok(out.includes("access_token=REDACTED"));
    assert.ok(out.includes("q=junk"), "harmless parameters should stay readable");
  });

  it("strips a bare Mapbox token wherever it appears", () => {
    // Mapbox echoes the token back in some error bodies.
    const body = `{"message":"Not Authorized - Invalid Token: ${MAPBOX_PUBLIC}"}`;
    const out = redact(body);
    assert.ok(!out.includes(MAPBOX_PUBLIC));
    assert.ok(out.includes("pk.REDACTED"));
  });

  it("strips a Mapbox secret token too, not just public ones", () => {
    const out = redact(`token=${MAPBOX_SECRET}`);
    assert.ok(!out.includes(MAPBOX_SECRET));
  });

  it("strips a Firecrawl key", () => {
    const out = redact(`{"error":"invalid key ${FIRECRAWL}"}`);
    assert.ok(!out.includes(FIRECRAWL));
    assert.ok(out.includes("fc-REDACTED"));
  });

  it("strips an Authorization header value", () => {
    const out = redact(`Authorization: Bearer ${GENERIC}${GENERIC}`);
    assert.ok(!out.includes(GENERIC));
    assert.ok(/Bearer REDACTED/.test(out));
  });

  it("strips every query-string key parameter spelling the providers use", () => {
    for (const param of ["apiKey", "api_key", "key", "token", "apikey", "access_token"]) {
      const out = redact(`https://example.com/v1/search?${param}=${GENERIC}&q=junk`);
      assert.ok(!out.includes(GENERIC), `${param} was not redacted`);
    }
  });

  it("is case-insensitive about parameter names", () => {
    const out = redact(`https://example.com?APIKEY=${GENERIC}`);
    assert.ok(!out.includes(GENERIC));
  });

  it("redacts several secrets in one blob", () => {
    const blob = `url=https://api.mapbox.com?access_token=${MAPBOX_PUBLIC} and key ${FIRECRAWL}`;
    const out = redact(blob);
    assert.ok(!out.includes(MAPBOX_PUBLIC));
    assert.ok(!out.includes(FIRECRAWL));
  });

  it("leaves ordinary business data untouched", () => {
    // Over-redacting would make the samples useless for diagnosis.
    const body = JSON.stringify({
      features: [
        {
          properties: {
            name: "Acme Junk Removal",
            metadata: { phone: "(617) 555-1234", website: "https://acmejunk.com" },
          },
        },
      ],
    });
    assert.equal(redact(body), body);
  });

  it("does not mangle a plain URL with no credentials", () => {
    const url = "https://api.mapbox.com/search/searchbox/v1/forward?q=junk+removal&limit=10";
    assert.equal(redact(url), url);
  });

  it("handles empty input", () => {
    assert.equal(redact(""), "");
  });
});
