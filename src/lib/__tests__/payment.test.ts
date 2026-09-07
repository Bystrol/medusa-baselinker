import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { resolvePayment } from "../payment";

describe("resolvePayment", () => {
  test("reports a captured payment as collected in full", () => {
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: 123.45,
    });

    assert.equal(payment.payment_done, 123.45);
    assert.equal(payment.payment_method_cod, false);
  });

  test("treats an authorized but uncaptured payment as unpaid", () => {
    // An authorization leaves the captured amount at zero: the money is
    // reserved, not taken, and the warehouse cares what has arrived.
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: 0,
    });

    assert.equal(payment.payment_done, 0);
  });

  test("reports a partial capture as the amount collected", () => {
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: 50,
    });

    assert.equal(payment.payment_done, 50);
  });

  test("marks a configured provider as cash on delivery", () => {
    const payment = resolvePayment({
      providerId: "pp_system_default",
      codProviderIds: ["pp_system_default"],
    });

    assert.equal(payment.payment_method_cod, true);
    assert.equal(payment.payment_done, 0);
  });

  test("never reports a cash-on-delivery order as partly collected", () => {
    // Whatever Medusa says, nothing has been collected before delivery.
    // A non-zero amount here would have the courier collect less than the
    // order is worth.
    const payment = resolvePayment({
      providerId: "pp_cod",
      capturedAmount: 200,
      codProviderIds: ["pp_cod"],
    });

    assert.equal(payment.payment_method_cod, true);
    assert.equal(payment.payment_done, 0);
  });

  test("does not mark an unlisted provider as cash on delivery", () => {
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: 10,
      codProviderIds: ["pp_system_default"],
    });

    assert.equal(payment.payment_method_cod, false);
  });

  test("uses the configured label for the provider", () => {
    const payment = resolvePayment({
      providerId: "pp_system_default",
      codProviderIds: ["pp_system_default"],
      labels: { pp_system_default: "Pobranie" },
    });

    assert.equal(payment.payment_method, "Pobranie");
  });

  test("falls back to the provider id when unmapped", () => {
    // Ugly in the Base panel, but it names exactly what to add to the map.
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: 10,
    });

    assert.equal(payment.payment_method, "pp_stripe_stripe");
  });

  test("falls back to a generic label when there is no provider at all", () => {
    const payment = resolvePayment({});

    assert.equal(payment.payment_method, "Medusa");
    assert.equal(payment.payment_method_cod, false);
    assert.equal(payment.payment_done, 0);
  });

  test("treats a collection with nothing captured as unpaid", () => {
    for (const amount of [0, null, undefined]) {
      const payment = resolvePayment({
        providerId: "pp_stripe_stripe",
        capturedAmount: amount as number | null | undefined,
      });

      assert.equal(payment.payment_done, 0, `captured ${amount}`);
    }
  });

  test("counts money that arrived even if partly refunded since", () => {
    // A refund is a separate movement Base tracks itself.
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: 80,
    });

    assert.equal(payment.payment_done, 80);
  });

  test("never reports a negative amount", () => {
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: -5,
    });

    assert.equal(payment.payment_done, 0);
  });

  test("coerces an amount the API hands over as a string", () => {
    const payment = resolvePayment({
      providerId: "pp_stripe_stripe",
      capturedAmount: "49.99" as unknown as number,
    });

    assert.equal(payment.payment_done, 49.99);
  });
});
