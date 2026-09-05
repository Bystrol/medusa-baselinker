import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapStockResponse, totalQuantity } from "../stock-mapper";
import type { BaseProductStock } from "../base-types";

const stockResponse = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "fixtures", "getInventoryProductsStock.json"),
    "utf8"
  )
).products as Record<string, BaseProductStock>;

describe("mapStockResponse", () => {
  test("emits variants instead of their parent", () => {
    const mapped = mapStockResponse(stockResponse);

    // 682782170 holds two variants and must not appear in its own right:
    // Base reports a parent's stock as the sum of its variants.
    assert.equal(mapped["682782170"], undefined);
    assert.deepEqual(mapped["682782171"], { bl_153201: 10, bl_153210: 0 });
    assert.deepEqual(mapped["682782172"], { bl_153201: 2, bl_153210: 0 });
  });

  test("emits a product without variants under its own id", () => {
    const mapped = mapStockResponse(stockResponse);

    // Seeded with 25, then two were ordered. Base decremented the stock itself
    // rather than recording a reservation, even though the inventory has
    // reservations enabled - so the figure read back is already 23.
    assert.deepEqual(mapped["682782169"], { bl_153201: 23, bl_153210: 0 });
  });

  test("keeps quantities per warehouse", () => {
    const mapped = mapStockResponse(stockResponse);

    assert.deepEqual(mapped["682782178"], { bl_153201: 12, bl_153210: 8 });
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
    // Nine products, one of which contributes two variants instead of itself.
    assert.equal(Object.keys(mapped).length, 10);
  });
});

describe("totalQuantity", () => {
  test("sums across warehouses", () => {
    assert.equal(totalQuantity({ bl_1: 12, bl_2: 8 }), 20);
    assert.equal(totalQuantity({}), 0);
  });
});
