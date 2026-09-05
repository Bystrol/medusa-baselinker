import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { planMissingProducts } from "../missing-products";

const known = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

describe("planMissingProducts", () => {
  test("reports nothing when every product came back", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: known,
      strategy: "draft",
      maxMissingRatio: 0.2,
    });

    assert.deepEqual(plan.missing, []);
    assert.equal(plan.aborted, false);
  });

  test("lists products that stopped coming back", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: known.slice(0, 9),
      strategy: "draft",
      maxMissingRatio: 0.2,
    });

    assert.deepEqual(plan.missing, ["10"]);
    assert.equal(plan.aborted, false);
    assert.equal(plan.ratio, 0.1);
  });

  test("does nothing under the ignore strategy", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: [],
      strategy: "ignore",
      maxMissingRatio: 0.2,
    });

    assert.deepEqual(plan.missing, []);
    assert.equal(plan.aborted, false);
  });

  test("aborts when too large a share went missing at once", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: known.slice(0, 5),
      strategy: "draft",
      maxMissingRatio: 0.2,
    });

    assert.equal(plan.aborted, true);
    assert.deepEqual(plan.missing, []);
    assert.match(plan.reason ?? "", /5 of 10/);
    assert.match(plan.reason ?? "", /max_missing_ratio/);
  });

  test("aborts on an empty response regardless of the ratio", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: [],
      strategy: "delete",
      // Even with the guard wide open, an empty catalog is refused.
      maxMissingRatio: 1,
    });

    assert.equal(plan.aborted, true);
    assert.match(plan.reason ?? "", /no products at all/);
  });

  test("allows a withdrawal exactly at the limit", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: known.slice(0, 8),
      strategy: "delete",
      maxMissingRatio: 0.2,
    });

    assert.equal(plan.aborted, false);
    assert.deepEqual(plan.missing, ["9", "10"]);
  });

  test("handles a first run with nothing mapped yet", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: [],
      seenBaseProductIds: ["1", "2"],
      strategy: "draft",
      maxMissingRatio: 0.2,
    });

    assert.deepEqual(plan.missing, []);
    assert.equal(plan.aborted, false);
    assert.equal(plan.ratio, 0);
  });

  test("carries the strategy through to the caller", () => {
    const plan = planMissingProducts({
      knownBaseProductIds: known,
      seenBaseProductIds: known.slice(0, 9),
      strategy: "delete",
      maxMissingRatio: 0.2,
    });

    assert.equal(plan.strategy, "delete");
    assert.deepEqual(plan.missing, ["10"]);
  });
});
