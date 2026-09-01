/**
 * Territory boundary tests.
 *
 * The rule being protected: a business is only ever rejected on evidence.
 * Being too eager here silently deletes leads from sources that don't return
 * coordinates, which are the same sources that find the newest businesses.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { haversineKm, isValidPoint, withinTerritory } from "../src/lib/geo.ts";

const NORWOOD = { lat: 42.1945, lng: -71.1995 };
const BOSTON = { lat: 42.3601, lng: -71.0589 };
const WORCESTER = { lat: 42.2626, lng: -71.8023 };

describe("haversineKm", () => {
  it("measures a known distance to within a kilometre", () => {
    // Norwood to Boston is about 22 km as the crow flies.
    const km = haversineKm(NORWOOD, BOSTON);
    assert.ok(km > 20 && km < 24, `expected ~22 km, got ${km.toFixed(1)}`);
  });

  it("is zero for the same point and symmetric between two", () => {
    assert.equal(haversineKm(NORWOOD, NORWOOD), 0);
    assert.equal(
      haversineKm(NORWOOD, WORCESTER).toFixed(6),
      haversineKm(WORCESTER, NORWOOD).toFixed(6),
    );
  });

  it("handles points either side of the equator and the meridian", () => {
    const km = haversineKm({ lat: -1, lng: -1 }, { lat: 1, lng: 1 });
    assert.ok(km > 300 && km < 320, `got ${km.toFixed(1)}`);
  });
});

describe("isValidPoint", () => {
  it("accepts real coordinates", () => {
    assert.equal(isValidPoint(42.19, -71.19), true);
  });

  it("rejects out-of-range, non-numeric and null-island coordinates", () => {
    assert.equal(isValidPoint(91, 0), false);
    assert.equal(isValidPoint(0, 181), false);
    assert.equal(isValidPoint("abc", 5), false);
    assert.equal(isValidPoint(null, null), false);
    assert.equal(isValidPoint(0, 0), false, "0,0 is what a provider sends when it means null");
  });
});

describe("withinTerritory", () => {
  const territory = { ...NORWOOD, radiusKm: 15 };

  it("keeps a business inside the radius", () => {
    const verdict = withinTerritory(territory, { lat: 42.2, lng: -71.21 });
    assert.equal(verdict.inRange, true);
    assert.ok((verdict.km ?? 99) < 2);
  });

  it("rejects one well outside it, and says how far", () => {
    const verdict = withinTerritory(territory, WORCESTER, "Norwood");
    assert.equal(verdict.inRange, false);
    assert.match(verdict.reason ?? "", /km from Norwood/);
    assert.match(verdict.reason ?? "", /15 km radius/);
  });

  it("allows a small margin beyond the stated radius", () => {
    // A radius is a rough intent, not a boundary; a business listed at its
    // registered office can sit just outside and still work the area.
    const tight = { ...NORWOOD, radiusKm: 20 };
    const verdict = withinTerritory(tight, BOSTON);
    assert.equal(verdict.inRange, true, "22 km against a 20 km radius is within tolerance");
  });

  it("rejects once the margin is genuinely exceeded", () => {
    const tight = { ...NORWOOD, radiusKm: 5 };
    assert.equal(withinTerritory(tight, BOSTON).inRange, false);
  });

  it("keeps a business whose location is unknown", () => {
    // Research and web results carry no coordinates. Dropping them would
    // delete the sources that find businesses the maps have never heard of.
    const verdict = withinTerritory(territory, { lat: null, lng: null });
    assert.equal(verdict.inRange, true);
    assert.equal(verdict.km, null);
  });

  it("keeps everything when the territory itself has not been geocoded", () => {
    const ungeocoded = { lat: null, lng: null, radiusKm: 15 };
    assert.equal(withinTerritory(ungeocoded, WORCESTER).inRange, true);
  });

  it("does not reject on a null-island coordinate", () => {
    // A provider sending 0,0 means "unknown"; treating it as a real point
    // would place the business off West Africa and reject it.
    assert.equal(withinTerritory(territory, { lat: 0, lng: 0 }).inRange, true);
  });
});
