import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { planOrderUpdates } from "../order-updates";

const mapping = (overrides = {}) => ({
  medusa_order_id: "order_1",
  base_order_id: "49673931",
  base_status_id: "513687",
  tracking_number: null,
  fulfilled_at: null,
  ...overrides,
});

const baseOrder = (overrides = {}) => ({
  order_id: 49673931,
  order_status_id: 513687,
  delivery_package_nr: "",
  delivery_package_module: "",
  ...overrides,
});

describe("planOrderUpdates", () => {
  test("reports no change when nothing moved", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping()],
      baseOrders: [baseOrder()],
    });

    assert.equal(update.changed, false);
    assert.equal(update.should_fulfill, false);
  });

  test("detects a status change", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping()],
      baseOrders: [baseOrder({ order_status_id: 513689 })],
    });

    assert.equal(update.changed, true);
    assert.equal(update.status_id, "513689");
  });

  test("detects a tracking number appearing", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping()],
      baseOrders: [
        baseOrder({
          delivery_package_nr: "SEED123",
          delivery_package_module: "other",
        }),
      ],
    });

    assert.equal(update.changed, true);
    assert.equal(update.tracking_number, "SEED123");
    assert.equal(update.courier_code, "other");
    // A tracking number means the parcel left, whatever the status is called.
    assert.equal(update.should_fulfill, true);
  });

  test("treats a configured shipped status as shipped without tracking", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping()],
      baseOrders: [baseOrder({ order_status_id: 513689 })],
      shippedStatusIds: ["513689"],
    });

    assert.equal(update.should_fulfill, true);
  });

  test("does not fulfil an order that already has a fulfillment", () => {
    const [update] = planOrderUpdates({
      mappings: [
        mapping({ fulfilled_at: new Date(), tracking_number: "SEED123" }),
      ],
      baseOrders: [baseOrder({ delivery_package_nr: "SEED123" })],
    });

    assert.equal(update.should_fulfill, false);
    assert.equal(update.changed, false);
  });

  test("reports a tracking number that changed after fulfillment", () => {
    // The parcel was re-sent under a new number; the change is worth recording
    // even though no second fulfillment should be created.
    const [update] = planOrderUpdates({
      mappings: [
        mapping({ fulfilled_at: new Date(), tracking_number: "SEED123" }),
      ],
      baseOrders: [baseOrder({ delivery_package_nr: "SEED999" })],
    });

    assert.equal(update.changed, true);
    assert.equal(update.should_fulfill, false);
  });

  test("skips orders Base did not return", () => {
    // Outside the polled window, or deleted upstream. Absence says nothing
    // about the order's state, so it must not be acted on.
    const updates = planOrderUpdates({
      mappings: [mapping(), mapping({ base_order_id: "99999999" })],
      baseOrders: [baseOrder()],
    });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].base_order_id, "49673931");
  });

  test("matches ids across the number and string forms Base mixes", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping({ base_order_id: "49673931" })],
      baseOrders: [baseOrder({ order_id: 49673931 })],
    });

    assert.ok(update);
    assert.equal(update.base_order_id, "49673931");
  });

  test("treats an empty tracking number as none", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping({ tracking_number: "" })],
      baseOrders: [baseOrder({ delivery_package_nr: "" })],
    });

    assert.equal(update.tracking_number, null);
    assert.equal(update.changed, false);
  });

  test("handles a first sync where nothing was recorded yet", () => {
    const [update] = planOrderUpdates({
      mappings: [mapping({ base_status_id: null })],
      baseOrders: [baseOrder()],
    });

    assert.equal(update.changed, true);
    assert.equal(update.status_id, "513687");
  });
});
