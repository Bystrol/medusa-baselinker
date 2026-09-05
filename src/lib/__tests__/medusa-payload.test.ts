import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toProductPayload, toVariantCreatePayload } from "../medusa-payload";
import { mapBaseProduct, type PriceGroup } from "../product-mapper";
import type { BaseProduct } from "../base-types";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "fixtures", `${name}.json`), "utf8")
  );

const productsData = fixture("getInventoryProductsData").products as Record<
  string,
  BaseProduct
>;

const priceGroups: PriceGroup[] = (
  fixture("getInventoryPriceGroups").price_groups as any[]
).map((group) => ({
  id: String(group.price_group_id),
  currency: group.currency,
  is_default: group.is_default,
}));

const mapOne = (sku: string) => {
  const entry = Object.entries(productsData).find(
    ([, product]) => product.sku === sku
  );
  assert.ok(entry, `fixture is missing a product with sku ${sku}`);
  return mapBaseProduct(entry[0], entry[1], { priceGroups });
};

describe("toProductPayload", () => {
  test("always carries options, which Medusa refuses to create without", () => {
    const payload = toProductPayload(mapOne("SEED-SIMPLE-001"));

    assert.equal(payload.options.length, 1);
    assert.equal(payload.options[0].title, "Variant");
    assert.deepEqual(payload.options[0].values, ["Default"]);
  });

  test("lists every variant's option value", () => {
    const payload = toProductPayload(mapOne("SEED-VARIANT-001"));

    assert.equal(payload.options[0].values.length, 2);
    assert.deepEqual(
      payload.options[0].values.sort(),
      payload.variants.map((v) => v.options["Variant"]).sort()
    );
  });

  test("keeps the Base id in external_id", () => {
    const mapped = mapOne("SEED-SIMPLE-001");
    const payload = toProductPayload(mapped);

    assert.equal(payload.external_id, mapped.base_product_id);
  });

  test("omits sales channel and shipping profile when not configured", () => {
    const payload = toProductPayload(mapOne("SEED-SIMPLE-001"));

    assert.equal("sales_channels" in payload, false);
    assert.equal("shipping_profile_id" in payload, false);
  });

  test("includes sales channel and shipping profile when configured", () => {
    const payload = toProductPayload(mapOne("SEED-SIMPLE-001"), {
      salesChannelId: "sc_1",
      shippingProfileId: "sp_1",
    }) as any;

    assert.deepEqual(payload.sales_channels, [{ id: "sc_1" }]);
    assert.equal(payload.shipping_profile_id, "sp_1");
  });

  test("drops dimensions Base reports as zero instead of sending them", () => {
    const payload = toProductPayload(mapOne("SEED-SPECIAL-001"));

    assert.equal(payload.weight, undefined);
    assert.equal(payload.height, undefined);
  });

  test("sends images as objects", () => {
    const payload = toProductPayload(mapOne("SEED-SIMPLE-001"));

    assert.equal(payload.images.length, 1);
    assert.ok(payload.images[0].url.startsWith("https://"));
  });
});

describe("toVariantCreatePayload", () => {
  test("manages inventory, since Base owns the stock", () => {
    const mapped = mapOne("SEED-SIMPLE-001");
    const payload = toVariantCreatePayload(mapped.variants[0], mapped.option_title);

    assert.equal(payload.manage_inventory, true);
  });

  test("passes prices through unscaled", () => {
    const mapped = mapOne("SEED-SIMPLE-001");
    const payload = toVariantCreatePayload(mapped.variants[0], mapped.option_title);
    const pln = payload.prices.find((p) => p.currency_code === "pln");

    assert.equal(pln?.amount, 49.99);
  });

  test("turns a missing ean into undefined rather than an empty string", () => {
    const mapped = mapOne("SEED-WAREHOUSE-001");
    const payload = toVariantCreatePayload(mapped.variants[0], mapped.option_title);

    assert.equal(payload.ean, undefined);
  });
});
