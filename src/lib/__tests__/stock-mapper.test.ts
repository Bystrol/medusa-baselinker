import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapStockResponse, totalQuantity } from "../stock-mapper";
import type { BaseProductStock } from "../base-types";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "fixtures", `${name}.json`), "utf8")
  );

const stockResponse = fixture("getInventoryProductsStock").products as Record<
  string,
  BaseProductStock
>;

const productsData = fixture("getInventoryProductsData").products as Record<
  string,
  { sku: string; variants?: Record<string, unknown> }
>;

/**
 * Ids change every time the account is re-seeded, so tests address products by
 * sku instead of pinning the numbers they happened to get.
 */
const idOf = (sku: string): string => {
  const entry = Object.entries(productsData).find(
    ([, product]) => product.sku === sku
  );
  if (!entry) throw new Error(`fixture is missing a product with sku ${sku}`);
  return entry[0];
};

const variantIdsOf = (sku: string): string[] =>
  Object.keys(productsData[idOf(sku)].variants ?? {});

describe("mapStockResponse", () => {
  test("emits variants instead of their parent", () => {
    const mapped = mapStockResponse(stockResponse);

    const parent = idOf("SEED-VARIANT-001");
    const [first, second] = variantIdsOf("SEED-VARIANT-001");

    // The parent holds two variants and must not appear in its own right:
    // Base reports a parent's stock as the sum of its variants.
    assert.equal(mapped[parent], undefined);
    assert.deepEqual(mapped[first], { bl_153201: 10, bl_153210: 0 });
    assert.deepEqual(mapped[second], { bl_153201: 3, bl_153210: 0 });
  });

  test("emits a product without variants under its own id", () => {
    const mapped = mapStockResponse(stockResponse);

    assert.deepEqual(mapped[idOf("SEED-SIMPLE-001")], {
      bl_153201: 25,
      bl_153210: 0,
    });
  });

  test("keeps quantities per warehouse", () => {
    const mapped = mapStockResponse(stockResponse);

    assert.deepEqual(mapped[idOf("SEED-WAREHOUSE-001")], {
      bl_153201: 12,
      bl_153210: 8,
    });
  });

  test("subtracts reservations from a product without variants", () => {
    const mapped = mapStockResponse({
      "1": {
        product_id: 1,
        stock: { bl_1: 25, bl_2: 4 },
        reservations: { bl_1: 10, bl_2: 9 },
      },
    });

    assert.equal(mapped["1"].bl_1, 15);
    // Reserving more than is held must not yield a negative quantity.
    assert.equal(mapped["1"].bl_2, 0);
  });

  test("subtracts per-variant reservations when Base sends them", () => {
    const mapped = mapStockResponse({
      "1": {
        product_id: 1,
        stock: { bl_1: 12 },
        reservations: { bl_1: 0 },
        variants: { "2": { bl_1: 10 }, "3": { bl_1: 2 } },
        variant_reservations: { "2": { bl_1: 4 } },
      },
    });

    assert.equal(mapped["2"].bl_1, 6);
    // Variant 3 has no reservations recorded and keeps its full quantity.
    assert.equal(mapped["3"].bl_1, 2);
  });

  test("tolerates variant_reservations arriving as an empty array", () => {
    const mapped = mapStockResponse({
      "1": {
        product_id: 1,
        stock: { bl_1: 10 },
        reservations: {},
        variants: { "2": { bl_1: 10 } },
        variant_reservations: [],
      },
    });

    assert.equal(mapped["2"].bl_1, 10);
  });

  test("coerces quantities the API sends as strings", () => {
    const mapped = mapStockResponse({
      "1": {
        product_id: 1,
        stock: { bl_1: "7" as unknown as number },
        reservations: { bl_1: "2" as unknown as number },
      },
    });

    assert.equal(mapped["1"].bl_1, 5);
    assert.equal(typeof mapped["1"].bl_1, "number");
  });

  test("covers every product in the fixture", () => {
    const mapped = mapStockResponse(stockResponse);

    // Every product contributes one entry, except those with variants, which
    // contribute one per variant and none for themselves.
    const expected = Object.values(productsData).reduce((sum, product) => {
      const variants = Object.keys(product.variants ?? {}).length;
      return sum + (variants || 1);
    }, 0);

    assert.equal(Object.keys(mapped).length, expected);
  });
});

describe("totalQuantity", () => {
  test("sums across warehouses", () => {
    assert.equal(totalQuantity({ bl_1: 12, bl_2: 8 }), 20);
    assert.equal(totalQuantity({}), 0);
  });
});
