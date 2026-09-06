import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVariantOptions, type OptionSource } from "../variant-options";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "fixtures", `${name}.json`), "utf8")
  );

const productsData = fixture("getInventoryProductsData").products as Record<
  string,
  { sku: string; variants?: Record<string, { name: string }> }
>;

const variantsData = fixture("getInventoryProductsData_variants")
  .products as Record<string, { sku: string; text_fields?: { features?: unknown } }>;

/**
 * Rebuilds the input the mapper assembles: variants nested under a parent,
 * paired with the features that only appear when each variant is fetched as a
 * product of its own.
 */
const sourcesFor = (sku: string): OptionSource[] => {
  const entry = Object.entries(productsData).find(
    ([, product]) => product.sku === sku
  );
  assert.ok(entry, `fixture is missing a product with sku ${sku}`);

  return Object.entries(entry[1].variants ?? {}).map(([id, variant]) => ({
    id,
    title: variant.name,
    features: (variantsData[id]?.text_fields?.features ?? null) as
      | Record<string, unknown>
      | null,
  }));
};

describe("resolveVariantOptions on recorded data", () => {
  test("derives real axes when every variant declares the same features", () => {
    const resolved = resolveVariantOptions(sourcesFor("SEED-FEATURES-001"));

    assert.equal(resolved.fromFeatures, true);
    assert.deepEqual(resolved.titles, ["Kolor", "Rozmiar"]);

    const combinations = Object.values(resolved.valuesByVariant);
    assert.equal(combinations.length, 2);
    assert.ok(
      combinations.some(
        (values) => values["Kolor"] === "Czerwony" && values["Rozmiar"] === "L"
      )
    );
    assert.ok(
      combinations.some(
        (values) => values["Kolor"] === "Niebieski" && values["Rozmiar"] === "M"
      )
    );
  });

  test("falls back when only some variants declare features", () => {
    const resolved = resolveVariantOptions(sourcesFor("SEED-MIXED-001"));

    assert.equal(resolved.fromFeatures, false);
    assert.deepEqual(resolved.titles, ["Variant"]);
    assert.deepEqual(Object.values(resolved.valuesByVariant), [
      { Variant: "Wariant z cechami" },
      { Variant: "Wariant bez cech" },
    ]);
  });

  test("falls back when no variant declares features", () => {
    const resolved = resolveVariantOptions(sourcesFor("SEED-VARIANT-001"));

    assert.equal(resolved.fromFeatures, false);
    assert.deepEqual(resolved.titles, ["Variant"]);
  });
});

describe("resolveVariantOptions edge cases", () => {
  const withFeatures = (
    entries: [string, string, Record<string, unknown> | null][]
  ): OptionSource[] =>
    entries.map(([id, title, features]) => ({ id, title, features }));

  test("handles a product with no variants", () => {
    const resolved = resolveVariantOptions([]);

    assert.deepEqual(resolved.titles, []);
    assert.equal(resolved.fromFeatures, false);
  });

  test("keeps the feature order the merchant used", () => {
    const resolved = resolveVariantOptions(
      withFeatures([
        ["1", "a", { Rozmiar: "L", Kolor: "Czerwony" }],
        ["2", "b", { Rozmiar: "M", Kolor: "Niebieski" }],
      ])
    );

    // Alphabetical order would have put Kolor first.
    assert.deepEqual(resolved.titles, ["Rozmiar", "Kolor"]);
  });

  test("falls back when the feature keys differ between variants", () => {
    const resolved = resolveVariantOptions(
      withFeatures([
        ["1", "a", { Kolor: "Czerwony" }],
        ["2", "b", { Rozmiar: "L" }],
      ])
    );

    assert.equal(resolved.fromFeatures, false);
  });

  test("falls back when two variants share a combination", () => {
    // Medusa requires each variant to occupy a distinct combination, so a
    // duplicate would be rejected outright at import time.
    const resolved = resolveVariantOptions(
      withFeatures([
        ["1", "a", { Kolor: "Czerwony" }],
        ["2", "b", { Kolor: "Czerwony" }],
      ])
    );

    assert.equal(resolved.fromFeatures, false);
    assert.deepEqual(resolved.valuesByVariant["2"], { Variant: "b" });
  });

  test("ignores features whose value is empty", () => {
    const resolved = resolveVariantOptions(
      withFeatures([
        ["1", "a", { Kolor: "Czerwony", Rozmiar: "" }],
        ["2", "b", { Kolor: "Niebieski", Rozmiar: "" }],
      ])
    );

    assert.deepEqual(resolved.titles, ["Kolor"]);
    assert.equal(resolved.fromFeatures, true);
  });

  test("suffixes duplicate names in the fallback", () => {
    const resolved = resolveVariantOptions(
      withFeatures([
        ["1", "Ten sam", null],
        ["2", "Ten sam", null],
      ])
    );

    assert.deepEqual(resolved.valuesByVariant["1"], { Variant: "Ten sam" });
    assert.deepEqual(resolved.valuesByVariant["2"], { Variant: "Ten sam 2" });
  });

  test("coerces non-string feature values", () => {
    const resolved = resolveVariantOptions(
      withFeatures([
        ["1", "a", { Rozmiar: 38 }],
        ["2", "b", { Rozmiar: 40 }],
      ])
    );

    assert.equal(resolved.fromFeatures, true);
    assert.deepEqual(resolved.valuesByVariant["1"], { Rozmiar: "38" });
  });
});
