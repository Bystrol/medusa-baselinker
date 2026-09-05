import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapBaseProduct, mapBaseProducts, type PriceGroup } from "../product-mapper";
import type { BaseProduct } from "../base-types";

/**
 * Every assertion below runs against responses recorded from a live Base
 * account, so the mapping stays pinned to how the API actually behaves rather
 * than how it is documented.
 */
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

const bySku = (sku: string): [string, BaseProduct] => {
  const entry = Object.entries(productsData).find(
    ([, product]) => product.sku === sku
  );
  assert.ok(entry, `fixture is missing a product with sku ${sku}`);
  return entry as [string, BaseProduct];
};

const mapOne = (sku: string) => {
  const [id, product] = bySku(sku);
  return mapBaseProduct(id, product, { priceGroups });
};

describe("mapBaseProduct", () => {
  test("gives a product without variants a single default variant", () => {
    const mapped = mapOne("SEED-SIMPLE-001");

    assert.equal(mapped.variants.length, 1);
    assert.equal(mapped.variants[0].title, "Default");
    assert.equal(mapped.variants[0].sku, "SEED-SIMPLE-001");
    assert.equal(mapped.variants[0].ean, "5901234123457");
    assert.equal(mapped.variants[0].is_synthetic, true);
    // The variant stands in for the product, so it carries the product's id.
    assert.equal(mapped.variants[0].base_variant_id, mapped.base_product_id);
  });

  test("keeps prices in Medusa's format without scaling", () => {
    const mapped = mapOne("SEED-SIMPLE-001");
    const pln = mapped.variants[0].prices.find((p) => p.currency_code === "pln");

    assert.equal(pln?.amount, 49.99);
  });

  test("coerces a price the API returned as a string", () => {
    const mapped = mapOne("SEED-VARIANT-001");
    const sizeL = mapped.variants.find((v) => v.sku === "SEED-VARIANT-001-L");
    const pln = sizeL?.prices.find((p) => p.currency_code === "pln");

    // Recorded as "89.00" for this variant while its sibling came back as 79.
    assert.equal(pln?.amount, 89);
    assert.equal(typeof pln?.amount, "number");
  });

  test("maps nested variants and does not carry parent stock", () => {
    const mapped = mapOne("SEED-VARIANT-001");

    assert.equal(mapped.variants.length, 2);
    assert.deepEqual(
      mapped.variants.map((v) => v.sku).sort(),
      ["SEED-VARIANT-001-L", "SEED-VARIANT-001-S"]
    );
    assert.ok(mapped.variants.every((v) => v.is_synthetic === false));
    // Base reports the parent's stock as the sum of its variants, so the
    // mapped product exposes no stock of its own.
    assert.equal("stock" in mapped, false);
  });

  test("turns an empty ean into null", () => {
    const mapped = mapOne("SEED-WAREHOUSE-001");

    assert.equal(mapped.variants[0].ean, null);
  });

  test("subtracts reservations from available stock", () => {
    const [id, product] = bySku("SEED-SIMPLE-001");
    const withReservations: BaseProduct = {
      ...product,
      stock: { bl_153201: 25, bl_153210: 4 },
      reservations: { bl_153201: 10, bl_153210: 9 },
    };

    const mapped = mapBaseProduct(id, withReservations, { priceGroups });

    assert.equal(mapped.variants[0].stock.bl_153201, 15);
    // Reserving more than is held must not produce a negative quantity.
    assert.equal(mapped.variants[0].stock.bl_153210, 0);
  });

  test("keeps stock per warehouse", () => {
    const mapped = mapOne("SEED-WAREHOUSE-001");

    assert.deepEqual(mapped.variants[0].stock, {
      bl_153201: 12,
      bl_153210: 8,
    });
  });

  test("resolves one price per currency across price groups", () => {
    const mapped = mapOne("SEED-PRICEGROUP-001");
    const currencies = mapped.variants[0].prices.map((p) => p.currency_code);

    assert.deepEqual(currencies.sort(), ["eur", "pln"]);
    assert.equal(
      mapped.variants[0].prices.find((p) => p.currency_code === "pln")?.amount,
      100
    );
    assert.equal(
      mapped.variants[0].prices.find((p) => p.currency_code === "eur")?.amount,
      110
    );
  });

  test("slugifies diacritics, quotes and slashes", () => {
    const mapped = mapOne("SEED-SPECIAL-001");

    assert.equal(mapped.handle, "zestaw-premium-zolc-cma-100-bawelna");
  });

  test("nulls out dimensions Base reports as zero", () => {
    const withDimensions = mapOne("SEED-SIMPLE-001");
    const withoutDimensions = mapOne("SEED-SPECIAL-001");

    assert.equal(withDimensions.weight, 0.5);
    assert.equal(withDimensions.height, 10);
    assert.equal(withoutDimensions.weight, null);
    assert.equal(withoutDimensions.height, null);
  });

  test("takes the thumbnail from the first image", () => {
    const withImage = mapOne("SEED-SIMPLE-001");
    const withoutImage = mapOne("SEED-MINIMAL-001");

    assert.equal(withImage.images.length, 1);
    assert.equal(withImage.thumbnail, withImage.images[0]);
    assert.deepEqual(withoutImage.images, []);
    assert.equal(withoutImage.thumbnail, null);
  });

  test("falls back to the sku when a product has no name", () => {
    const [id, product] = bySku("SEED-SIMPLE-001");
    const unnamed: BaseProduct = { ...product, text_fields: {} };

    const mapped = mapBaseProduct(id, unnamed, { priceGroups });

    assert.equal(mapped.title, "SEED-SIMPLE-001");
    assert.equal(mapped.handle, "seed-simple-001");
  });

  test("falls back to the id when a product has neither name nor sku", () => {
    const [id, product] = bySku("SEED-SIMPLE-001");
    const anonymous: BaseProduct = { ...product, text_fields: {}, sku: "" };

    const mapped = mapBaseProduct(id, anonymous, { priceGroups });

    assert.equal(mapped.title, `Base product ${id}`);
  });
});

describe("mapBaseProducts", () => {
  test("gives colliding titles distinct handles", () => {
    const mapped = mapBaseProducts(productsData, { priceGroups });
    const duplicates = mapped.filter((p) => p.title === "Seed Duplicate Name");

    assert.equal(duplicates.length, 2);
    assert.equal(duplicates[0].handle, "seed-duplicate-name");
    assert.equal(duplicates[1].handle, "seed-duplicate-name-2");
  });

  test("assigns handle suffixes deterministically across runs", () => {
    const first = mapBaseProducts(productsData, { priceGroups });
    // Reversing the input must not change which product keeps the bare handle.
    const reversed = Object.fromEntries(
      Object.entries(productsData).reverse()
    ) as Record<string, BaseProduct>;
    const second = mapBaseProducts(reversed, { priceGroups });

    assert.deepEqual(
      first.map((p) => [p.base_product_id, p.handle]),
      second.map((p) => [p.base_product_id, p.handle])
    );
  });

  test("respects handles already taken elsewhere in Medusa", () => {
    const taken = new Set(["seed-simple-product"]);
    const mapped = mapBaseProducts(productsData, { priceGroups, takenHandles: taken });
    const simple = mapped.find((p) => p.title === "Seed Simple Product");

    assert.equal(simple?.handle, "seed-simple-product-2");
  });

  test("maps every product in the fixture with at least one variant", () => {
    const mapped = mapBaseProducts(productsData, { priceGroups });

    assert.equal(mapped.length, Object.keys(productsData).length);
    assert.ok(mapped.every((p) => p.variants.length >= 1));
    assert.ok(mapped.every((p) => p.handle !== ""));
  });
});
