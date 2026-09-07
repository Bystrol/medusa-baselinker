import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  extractPickupPointId,
  findPickupPointId,
  DEFAULT_PICKUP_POINT_KEYS,
} from "../pickup-point";

describe("extractPickupPointId", () => {
  test("finds the id under the default keys", () => {
    // target_point is what the InPost fulfillment plugin writes.
    assert.equal(
      extractPickupPointId({ target_point: "KRA010" }),
      "KRA010"
    );
    assert.equal(extractPickupPointId({ point_id: "P123" }), "P123");
  });

  test("returns null when the data names no point", () => {
    // A courier delivering to an address leaves nothing here, which is not an
    // error - the order simply travels without a pickup point.
    assert.equal(extractPickupPointId({ service_type: "courier" }), null);
    assert.equal(extractPickupPointId({}), null);
    assert.equal(extractPickupPointId(null), null);
    assert.equal(extractPickupPointId(undefined), null);
  });

  test("honours the configured order of keys", () => {
    const data = { target_point: "FIRST", point_id: "SECOND" };

    assert.equal(extractPickupPointId(data, ["point_id", "target_point"]), "SECOND");
    assert.equal(extractPickupPointId(data, ["target_point", "point_id"]), "FIRST");
  });

  test("reads a nested key through a dotted path", () => {
    assert.equal(
      extractPickupPointId({ point: { id: "WAW42" } }, ["point.id"]),
      "WAW42"
    );
  });

  test("ignores an empty or blank value and keeps looking", () => {
    assert.equal(
      extractPickupPointId({ target_point: "   ", point_id: "P9" }),
      "P9"
    );
  });

  test("coerces a value the plugin stored as a number", () => {
    assert.equal(extractPickupPointId({ point_id: 12345 }), "12345");
  });

  test("survives a nested path that does not exist", () => {
    assert.equal(
      extractPickupPointId({ point: "nie obiekt" }, ["point.id"]),
      null
    );
  });

  test("does not treat an unconfigured key as a match", () => {
    assert.equal(
      extractPickupPointId({ locker: "X1" }, DEFAULT_PICKUP_POINT_KEYS),
      null
    );
    assert.equal(extractPickupPointId({ locker: "X1" }, ["locker"]), "X1");
  });
});

describe("findPickupPointId", () => {
  test("takes the point from whichever method names one", () => {
    const id = findPickupPointId([
      { data: {} },
      { data: { target_point: "KRA010" } },
    ]);

    assert.equal(id, "KRA010");
  });

  test("returns null when no method names a point", () => {
    assert.equal(findPickupPointId([{ data: {} }, {}]), null);
    assert.equal(findPickupPointId([]), null);
    assert.equal(findPickupPointId(null), null);
  });

  test("tolerates a method with no data at all", () => {
    assert.equal(
      findPickupPointId([{}, { data: null }, { data: { point_id: "P1" } }]),
      "P1"
    );
  });
});
