/**
 * Identity and dedupe tests — the "no repeats" guarantee.
 *
 * Run with `npm test`. Imports the module under test directly, which is why
 * identity.ts deliberately has no runtime imports.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apexDomain,
  groupByIdentity,
  identityKeysFor,
  isSharedHost,
  nameCityKey,
  normaliseName,
  phoneKey,
} from "../src/lib/identity.ts";

describe("phoneKey", () => {
  it("normalises the formats a phone number actually arrives in", () => {
    const expected = "6175551234";
    for (const input of [
      "(617) 555-1234",
      "617-555-1234",
      "617.555.1234",
      "+1 617 555 1234",
      "16175551234",
      " 617 555 1234 ",
    ]) {
      assert.equal(phoneKey(input), expected, `failed on ${input}`);
    }
  });

  it("rejects anything that isn't a dialable US number", () => {
    for (const input of ["555-1234", "", null, undefined, "not a phone", "0175551234"]) {
      assert.equal(phoneKey(input), null, `should have rejected ${String(input)}`);
    }
  });

  it("rejects a leading 1 in the exchange", () => {
    assert.equal(phoneKey("617-155-1234"), null);
  });
});

describe("apexDomain", () => {
  it("reduces a URL to its registrable domain", () => {
    assert.equal(apexDomain("https://www.acmejunk.com/services/"), "acmejunk.com");
    assert.equal(apexDomain("http://acmejunk.com"), "acmejunk.com");
    assert.equal(apexDomain("acmejunk.com"), "acmejunk.com");
    assert.equal(apexDomain("https://BOOKING.AcmeJunk.com"), "acmejunk.com");
  });

  it("handles compound public suffixes", () => {
    assert.equal(apexDomain("https://www.acmejunk.co.uk/about"), "acmejunk.co.uk");
  });

  it("refuses hosts that many businesses share", () => {
    for (const url of [
      "https://facebook.com/acmejunk",
      "https://www.yelp.com/biz/acme-junk",
      "https://kw.com/agent/janedoe",
      "https://acmejunk.wixsite.com/home",
      "https://sites.google.com/view/acmejunk",
    ]) {
      assert.equal(apexDomain(url), null, `${url} must not identify a business`);
      assert.equal(isSharedHost(url), true);
    }
  });

  it("returns null for junk rather than throwing", () => {
    for (const input of ["", null, undefined, "not a url", "localhost"]) {
      assert.equal(apexDomain(input), null);
    }
  });
});

describe("normaliseName", () => {
  it("strips the boilerplate that varies between listings", () => {
    assert.equal(normaliseName("Acme Junk Removal LLC"), normaliseName("Acme Junk Removal"));
    assert.equal(normaliseName("The Acme Company"), normaliseName("Acme"));
    assert.equal(normaliseName("Acme Hauling Services, Inc."), normaliseName("Acme Hauling"));
  });

  it("keeps genuinely different businesses apart", () => {
    assert.notEqual(normaliseName("Acme Junk"), normaliseName("Apex Junk"));
  });
});

describe("identityKeysFor", () => {
  it("ranks phone above domain above name", () => {
    const keys = identityKeysFor({
      name: "Acme Junk",
      phone: "(617) 555-1234",
      city: "Norwood",
      website: "https://acmejunk.com",
    });
    assert.deepEqual(keys, [
      "p:6175551234",
      "d:acmejunk.com",
      `n:${nameCityKey("Acme Junk", "Norwood")}`,
    ]);
  });

  it("still produces a key when only a name is known", () => {
    const keys = identityKeysFor({ name: "Acme Junk", city: "Norwood" });
    assert.equal(keys.length, 1);
    assert.ok(keys[0].startsWith("n:"));
  });

  it("produces no key for a name with nothing distinctive in it", () => {
    // "The Company LLC" normalises away to nothing, and would otherwise
    // collide with every other such listing in the same town.
    assert.deepEqual(identityKeysFor({ name: "The Company LLC", city: "Norwood" }), []);
  });

  it("does not key on a shared host", () => {
    const keys = identityKeysFor({
      name: "Acme Junk",
      city: "Norwood",
      website: "https://facebook.com/acmejunk",
    });
    assert.ok(!keys.some((k) => k.startsWith("d:")));
  });
});

describe("groupByIdentity", () => {
  const keysOf = (b: { name: string; phone?: string | null; city?: string | null; website?: string | null }) =>
    identityKeysFor(b);

  it("merges records that share a phone number", () => {
    const groups = groupByIdentity(
      [
        { name: "Acme Junk Removal", phone: "617-555-1234", city: "Norwood" },
        { name: "Acme Junk", phone: "(617) 555-1234", city: "Norwood" },
      ],
      keysOf,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 2);
  });

  it("merges records that share only a website domain", () => {
    const groups = groupByIdentity(
      [
        { name: "Acme Junk Removal", city: "Norwood", website: "https://acmejunk.com" },
        { name: "Acme Hauling", city: "Dedham", website: "https://www.acmejunk.com/contact" },
      ],
      keysOf,
    );
    assert.equal(groups.length, 1, "same site means same business, whatever the listing calls it");
  });

  it("merges transitively — the case a single-key map gets wrong", () => {
    // A has a phone only. B has that phone and a domain. C has that domain
    // only. A and C share nothing directly, but all three are one business.
    const groups = groupByIdentity(
      [
        { name: "Acme Junk", phone: "617-555-1234", city: "Norwood" },
        { name: "Acme Junk", phone: "617-555-1234", city: "Norwood", website: "https://acmejunk.com" },
        { name: "Totally Different Name", city: "Norwood", website: "https://acmejunk.com" },
      ],
      keysOf,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 3);
  });

  it("keeps separate businesses separate", () => {
    const groups = groupByIdentity(
      [
        { name: "Acme Junk", phone: "617-555-1234", city: "Norwood" },
        { name: "Apex Hauling", phone: "617-555-9999", city: "Norwood" },
      ],
      keysOf,
    );
    assert.equal(groups.length, 2);
  });

  it("does not merge two businesses just because both are on Facebook", () => {
    const groups = groupByIdentity(
      [
        { name: "Acme Junk", city: "Norwood", website: "https://facebook.com/acme" },
        { name: "Apex Hauling", city: "Norwood", website: "https://facebook.com/apex" },
      ],
      keysOf,
    );
    assert.equal(groups.length, 2, "facebook.com must never be an identity");
  });

  it("returns the group's keys strongest-first, so the canonical id is stable", () => {
    const groups = groupByIdentity(
      [
        { name: "Acme Junk", city: "Norwood", website: "https://acmejunk.com" },
        { name: "Acme Junk", phone: "617-555-1234", city: "Norwood" },
      ],
      keysOf,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].keys[0], "p:6175551234");
    assert.ok(groups[0].keys.includes("d:acmejunk.com"));
  });

  it("gives the same canonical key regardless of the order records arrive in", () => {
    const a = { name: "Acme Junk", city: "Norwood", website: "https://acmejunk.com" };
    const b = { name: "Acme Junk", phone: "617-555-1234", city: "Norwood" };
    const forward = groupByIdentity([a, b], keysOf)[0].keys[0];
    const reverse = groupByIdentity([b, a], keysOf)[0].keys[0];
    assert.equal(forward, reverse);
  });

  it("never drops a record, even one with no usable identity", () => {
    const items = [
      { name: "The Company LLC", city: "Norwood" },
      { name: "Also The Co", city: "Norwood" },
      { name: "Acme Junk", phone: "617-555-1234", city: "Norwood" },
    ];
    const groups = groupByIdentity(items, keysOf);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    assert.equal(total, items.length);
    assert.equal(groups.length, 3, "unidentifiable records must not collapse into each other");
  });

  it("handles an empty input", () => {
    assert.deepEqual(groupByIdentity([], keysOf), []);
  });
});

describe("cross-run dedupe", () => {
  /** What storage does: every key a lead has ever matched on points at it. */
  const remember = (store: Map<string, string>, keys: string[], leadId: string) => {
    for (const k of keys) if (!store.has(k)) store.set(k, leadId);
  };
  const resolve = (store: Map<string, string>, keys: string[]) =>
    keys.map((k) => store.get(k)).find(Boolean) ?? null;

  it("re-finding a business with a new phone number resolves to the first lead", () => {
    const store = new Map<string, string>();

    // Run 1 knows only the name.
    const run1 = identityKeysFor({ name: "Acme Junk", city: "Norwood" });
    remember(store, run1, "lead-1");

    // Run 2 finds it again, now with a phone. The strongest key is brand new,
    // but the name key it still carries resolves to lead-1 — which is what
    // stops a second row being created.
    const run2 = identityKeysFor({ name: "Acme Junk LLC", phone: "617-555-1234", city: "Norwood" });
    assert.notEqual(run2[0], run1[0], "the strongest key really has changed");
    assert.equal(resolve(store, run2), "lead-1");
  });

  it("re-finding a business under a new trading name resolves via its domain", () => {
    const store = new Map<string, string>();
    remember(
      store,
      identityKeysFor({ name: "Acme Junk", city: "Norwood", website: "https://acmejunk.com" }),
      "lead-1",
    );

    const rebranded = identityKeysFor({
      name: "Acme Hauling & Cleanouts",
      city: "Norwood",
      website: "https://acmejunk.com/services",
    });
    assert.equal(resolve(store, rebranded), "lead-1");
  });

  it("keeps a lead's original id even as it accumulates keys over several runs", () => {
    const store = new Map<string, string>();
    remember(store, identityKeysFor({ name: "Acme Junk", city: "Norwood" }), "lead-1");
    remember(
      store,
      identityKeysFor({ name: "Acme Junk", city: "Norwood", website: "https://acmejunk.com" }),
      "lead-1",
    );
    remember(
      store,
      identityKeysFor({ name: "Acme Junk", phone: "617-555-1234", city: "Norwood" }),
      "lead-1",
    );

    // Any single piece of evidence now finds the same lead.
    assert.equal(resolve(store, ["p:6175551234"]), "lead-1");
    assert.equal(resolve(store, ["d:acmejunk.com"]), "lead-1");
    assert.equal(resolve(store, [`n:${nameCityKey("Acme Junk", "Norwood")}`]), "lead-1");
  });

  it("documents the boundary: a renamed business with no shared phone or domain is not matched", () => {
    // This is the known limit of the scheme. Matching purely on similar names
    // would risk merging two genuinely different local operators, which loses
    // a real lead silently — a worse failure than showing a duplicate.
    const store = new Map<string, string>();
    remember(store, identityKeysFor({ name: "Acme Junk", city: "Norwood" }), "lead-1");

    const renamed = identityKeysFor({ name: "Acme Junk Removal", city: "Norwood" });
    assert.equal(resolve(store, renamed), null);
  });
});
