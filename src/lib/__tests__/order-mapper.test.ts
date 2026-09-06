import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  toBaseOrderPayload,
  toOrderLine,
  type OrderExportInput,
} from "../order-mapper";

const baseInput = (
  overrides: Partial<OrderExportInput> = {}
): OrderExportInput => ({
  medusa_order_id: "order_01ABC",
  created_at: "2026-09-06T10:00:00.000Z",
  currency_code: "pln",
  email: "klient@example.com",
  storage_id: "bl_115553",
  order_status_id: 513687,
  custom_source_id: 42,
  shipping_method_name: "Kurier",
  shipping_price: 15.99,
  shipping_address: {
    first_name: "Jan",
    last_name: "Testowy",
    address_1: "Testowa 1",
    city: "Warszawa",
    postal_code: "00-001",
    country_code: "pl",
    phone: "600100200",
  },
  lines: [
    {
      base_variant_id: "682782172",
      title: "Seed Variant Product - Size L",
      sku: "SEED-VARIANT-001-L",
      ean: "5901234123488",
      unit_price: 89,
      tax_rate: 23,
      quantity: 2,
    },
  ],
  ...overrides,
});

describe("toBaseOrderPayload", () => {
  test("sends the unit price, not the line total", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    // Base multiplies by quantity itself; sending the total would double the
    // order value on a line of two.
    assert.equal(payload.products[0].price_brutto, 89);
    assert.equal(payload.products[0].quantity, 2);
  });

  test("addresses a line by the variant's own Base id", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    assert.equal(payload.products[0].product_id, "682782172");
    assert.equal(payload.products[0].storage_id, "bl_115553");
    // Base records the variant as the product; variant_id stays out of it.
    assert.equal("variant_id" in payload.products[0], false);
  });

  test("converts the timestamp to seconds", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    // Base rejects a millisecond value outright.
    assert.equal(payload.date_add, 1788688800);
    assert.ok(String(payload.date_add).length === 10);
  });

  test("upcases the currency and country codes", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    assert.equal(payload.currency, "PLN");
    assert.equal(payload.delivery_country_code, "PL");
  });

  test("carries the Medusa order id back for reconciliation", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    assert.match(payload.admin_comments, /order_01ABC/);
    assert.equal(payload.extra_field_1, "order_01ABC");
  });

  test("falls back to the shipping address when there is no billing one", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    assert.equal(payload.invoice_fullname, "Jan Testowy");
    assert.equal(payload.invoice_city, "Warszawa");
  });

  test("keeps a separate billing address when given one", () => {
    const payload = toBaseOrderPayload(
      baseInput({
        billing_address: {
          first_name: "Anna",
          last_name: "Firmowa",
          company: "Firma sp. z o.o.",
          address_1: "Fakturowa 5",
          city: "Kraków",
          postal_code: "30-001",
          country_code: "pl",
        },
      })
    ) as any;

    assert.equal(payload.invoice_fullname, "Anna Firmowa");
    assert.equal(payload.invoice_company, "Firma sp. z o.o.");
    assert.equal(payload.invoice_city, "Kraków");
    // The delivery side must not be overwritten by the billing one.
    assert.equal(payload.delivery_city, "Warszawa");
  });

  test("joins both address lines", () => {
    const payload = toBaseOrderPayload(
      baseInput({
        shipping_address: {
          first_name: "Jan",
          last_name: "Testowy",
          address_1: "Testowa 1",
          address_2: "m. 5",
          city: "Warszawa",
          postal_code: "00-001",
          country_code: "pl",
        },
      })
    ) as any;

    assert.equal(payload.delivery_address, "Testowa 1 m. 5");
  });

  test("takes the phone from the address when the order has none", () => {
    const payload = toBaseOrderPayload(baseInput({ phone: null })) as any;

    assert.equal(payload.phone, "600100200");
  });

  test("tolerates an order with no addresses at all", () => {
    const payload = toBaseOrderPayload(
      baseInput({ shipping_address: null, billing_address: null })
    ) as any;

    assert.equal(payload.delivery_fullname, "");
    assert.equal(payload.invoice_fullname, "");
    assert.equal(payload.delivery_country_code, "");
  });

  test("turns a missing ean into undefined rather than an empty string", () => {
    const payload = toBaseOrderPayload(
      baseInput({
        lines: [
          {
            base_variant_id: "1",
            title: "Bez EAN",
            sku: "NO-EAN",
            ean: "",
            unit_price: 10,
            tax_rate: 0,
            quantity: 1,
          },
        ],
      })
    ) as any;

    assert.equal(payload.products[0].ean, undefined);
  });

  test("passes the configured status and source through", () => {
    const payload = toBaseOrderPayload(baseInput()) as any;

    assert.equal(payload.order_status_id, 513687);
    assert.equal(payload.custom_source_id, 42);
  });

  test("maps every line", () => {
    const payload = toBaseOrderPayload(
      baseInput({
        lines: [
          ...baseInput().lines,
          {
            base_variant_id: "682782169",
            title: "Seed Simple Product",
            sku: "SEED-SIMPLE-001",
            ean: null,
            unit_price: 49.99,
            tax_rate: 23,
            quantity: 1,
          },
        ],
      })
    ) as any;

    assert.equal(payload.products.length, 2);
    assert.equal(payload.products[1].price_brutto, 49.99);
  });
});

describe("toOrderLine", () => {
  test("adds tax when the price excludes it", () => {
    // Base wants gross; a net 100 at 23% has to arrive as 123.
    const line = toOrderLine(
      {
        title: "Produkt",
        quantity: 2,
        unit_price: 100,
        is_tax_inclusive: false,
        tax_lines: [{ rate: 23 }],
      },
      "1"
    );

    assert.equal(line.unit_price, 123);
    assert.equal(line.tax_rate, 23);
    assert.equal(line.quantity, 2);
  });

  test("leaves a tax-inclusive price alone", () => {
    const line = toOrderLine(
      {
        title: "Produkt",
        quantity: 1,
        unit_price: 123,
        is_tax_inclusive: true,
        tax_lines: [{ rate: 23 }],
      },
      "1"
    );

    assert.equal(line.unit_price, 123);
  });

  test("rounds to cents rather than passing float noise upstream", () => {
    const line = toOrderLine(
      {
        title: "Produkt",
        quantity: 1,
        unit_price: 79,
        is_tax_inclusive: false,
        tax_lines: [{ rate: 23 }],
      },
      "1"
    );

    assert.equal(line.unit_price, 97.17);
  });

  test("sums several tax lines", () => {
    const line = toOrderLine(
      {
        title: "Produkt",
        quantity: 1,
        unit_price: 100,
        tax_lines: [{ rate: 20 }, { rate: 3 }],
      },
      "1"
    );

    assert.equal(line.tax_rate, 23);
    assert.equal(line.unit_price, 123);
  });

  test("passes the price through untouched when there is no tax", () => {
    const line = toOrderLine(
      { title: "Produkt", quantity: 1, unit_price: 49.99, tax_lines: [] },
      "1"
    );

    assert.equal(line.unit_price, 49.99);
    assert.equal(line.tax_rate, 0);
  });

  test("treats a missing quantity as one", () => {
    const line = toOrderLine({ title: "Produkt", quantity: 0, unit_price: 30 }, "1");

    assert.equal(line.quantity, 1);
  });

  test("takes the ean from the mapping, since the order line has none", () => {
    const withEan = toOrderLine(
      { title: "Produkt", quantity: 1, unit_price: 10, variant_sku: "SKU" },
      "1",
      "5901234123457"
    );
    const withoutEan = toOrderLine(
      { title: "Produkt", quantity: 1, unit_price: 10 },
      "1",
      ""
    );

    assert.equal(withEan.ean, "5901234123457");
    assert.equal(withoutEan.ean, null);
  });
});
