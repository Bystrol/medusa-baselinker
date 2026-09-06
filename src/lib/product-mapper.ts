/**
 * Maps Base.com catalog data onto the shape Medusa needs.
 *
 * Pure functions on purpose: no container, no network, no Medusa imports, so
 * the whole mapping is testable against the recorded fixtures long after the
 * Base trial expires.
 */

import type { BaseProduct, BaseVariant, BaseStockMap } from "./base-types";
import {
  toNumber,
  toText,
  toTextOrNull,
  toPositiveOrNull,
} from "./coerce";
import { toHandle, uniqueHandle } from "./slug";
import {
  resolveVariantOptions,
  FALLBACK_OPTION_TITLE,
  type OptionSource,
} from "./variant-options";

export interface PriceGroup {
  /** Base price group id, as it appears in the price maps. */
  id: string;
  currency: string;
  is_default?: boolean;
}

export interface MappedPrice {
  currency_code: string;
  amount: number;
}

export interface MappedVariant {
  /** Base id of this variant. Equals the product id for a synthesized variant. */
  base_variant_id: string;
  base_product_id: string;
  title: string;
  sku: string | null;
  ean: string | null;
  prices: MappedPrice[];
  /** Available quantity per Base warehouse key ("bl_153201"). */
  stock: Record<string, number>;
  /**
   * This variant's value for each of the product's options, keyed by option
   * title. Derived from Base features where they describe the variants
   * consistently, and from the variant name otherwise.
   */
  option_values: Record<string, string>;
  /**
   * True when Base had no variants and this one was built from the product.
   * Worth keeping: it tells the sync that the variant has no Base identity of
   * its own, so a variant appearing later must replace rather than duplicate it.
   */
  is_synthetic: boolean;
}

export interface MappedProduct {
  base_product_id: string;
  title: string;
  handle: string;
  description: string | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  length: number | null;
  images: string[];
  thumbnail: string | null;
  /**
   * The product's options and their values.
   *
   * createProductsWorkflow throws outright for a product with no options -
   * "Product options are not provided for: [...]" - so there is always at
   * least one, even if it had to be generated.
   */
  options: { title: string; values: string[] }[];
  /** False when the options were generated because features were unusable. */
  options_from_features: boolean;
  /**
   * Always at least one variant. Note there is deliberately no product-level
   * stock: for a product with variants, Base reports the parent's stock as the
   * sum of its variants, so carrying both would double count.
   */
  variants: MappedVariant[];
}

export interface MapProductOptions {
  /** Price groups from getInventoryPriceGroups, used to resolve currencies. */
  priceGroups: PriceGroup[];
  /**
   * Handles already in use. Passed in and mutated so a batch of products stays
   * collision free; Base allows several products to share a name.
   */
  takenHandles?: Set<string>;
  /**
   * Features per Base variant id, from fetching variants as their own
   * products. Without them only the generated fallback option is possible.
   */
  variantFeatures?: Record<string, Record<string, unknown> | null>;
}

/** Available stock is what Base holds minus what it has already reserved. */
const availableStock = (
  stock: BaseStockMap,
  reservations: BaseStockMap = {}
): Record<string, number> => {
  const result: Record<string, number> = {};

  for (const [warehouse, quantity] of Object.entries(stock ?? {})) {
    const available =
      toNumber(quantity) - toNumber((reservations ?? {})[warehouse]);
    result[warehouse] = Math.max(0, available);
  }

  return result;
};

/**
 * Resolves Base's price-group-keyed map into currency amounts.
 *
 * Several price groups can share a currency, and Medusa wants one amount per
 * currency, so the default group wins and later duplicates are dropped.
 */
const mapPrices = (
  prices: Record<string, unknown> | undefined,
  priceGroups: PriceGroup[]
): MappedPrice[] => {
  const ordered = [...priceGroups].sort(
    (a, b) => Number(b.is_default ?? false) - Number(a.is_default ?? false)
  );

  const seen = new Set<string>();
  const result: MappedPrice[] = [];

  for (const group of ordered) {
    const raw = (prices ?? {})[group.id];
    if (raw === undefined || raw === null) continue;

    const currency = group.currency.toLowerCase();
    if (seen.has(currency)) continue;

    seen.add(currency);
    result.push({ currency_code: currency, amount: toNumber(raw) });
  }

  return result;
};

/** Images arrive keyed by position ("1", "2", ...) rather than as an array. */
const mapImages = (images: Record<string, string> | undefined): string[] =>
  Object.entries(images ?? {})
    .sort(([a], [b]) => toNumber(a) - toNumber(b))
    .map(([, url]) => toText(url))
    .filter((url) => url !== "");

const mapVariant = (
  baseVariantId: string,
  variant: BaseVariant,
  baseProductId: string,
  priceGroups: PriceGroup[],
  optionValues: Record<string, string>
): MappedVariant => ({
  base_variant_id: baseVariantId,
  base_product_id: baseProductId,
  title: toText(variant.name) || baseVariantId,
  sku: toTextOrNull(variant.sku),
  ean: toTextOrNull(variant.ean),
  prices: mapPrices(variant.prices, priceGroups),
  // Base exposes reservations on the parent only, so variant stock is taken
  // at face value. Erring toward the lower number is not an option here.
  stock: availableStock(variant.stock),
  option_values: optionValues,
  is_synthetic: false,
});

/**
 * Builds the single variant Medusa requires for a product Base holds without
 * any. Skipping them instead leaves the product in Medusa unbuyable.
 */
const synthesizeVariant = (
  baseProductId: string,
  product: BaseProduct,
  priceGroups: PriceGroup[]
): MappedVariant => ({
  base_variant_id: baseProductId,
  base_product_id: baseProductId,
  title: "Default",
  sku: toTextOrNull(product.sku),
  ean: toTextOrNull(product.ean),
  prices: mapPrices(product.prices, priceGroups),
  stock: availableStock(product.stock, product.reservations),
  option_values: { [FALLBACK_OPTION_TITLE]: "Default" },
  is_synthetic: true,
});

export const mapBaseProduct = (
  baseProductId: string,
  product: BaseProduct,
  options: MapProductOptions
): MappedProduct => {
  const { priceGroups } = options;
  const takenHandles = options.takenHandles ?? new Set<string>();

  // Base allows a product with neither name nor sku; the id keeps it addressable.
  const title =
    toText(product.text_fields?.name) ||
    toText(product.sku) ||
    `Base product ${baseProductId}`;

  const images = mapImages(product.images);

  const variantEntries = Object.entries(product.variants ?? {});

  const sources: OptionSource[] = variantEntries.map(([variantId, variant]) => ({
    id: variantId,
    title: toText(variant.name) || variantId,
    features: options.variantFeatures?.[variantId],
  }));

  const resolved = resolveVariantOptions(sources);

  const variants = variantEntries.length
    ? variantEntries.map(([variantId, variant]) =>
        mapVariant(
          variantId,
          variant,
          baseProductId,
          priceGroups,
          resolved.valuesByVariant[variantId] ?? {}
        )
      )
    : [synthesizeVariant(baseProductId, product, priceGroups)];

  // A product with no variants still needs an axis for its synthesized one.
  const optionTitles = resolved.titles.length
    ? resolved.titles
    : [FALLBACK_OPTION_TITLE];

  const productOptions = optionTitles.map((title) => ({
    title,
    values: Array.from(
      new Set(variants.map((variant) => variant.option_values[title] ?? ""))
    ).filter((value) => value !== ""),
  }));

  return {
    base_product_id: baseProductId,
    title,
    handle: uniqueHandle(toHandle(title), takenHandles),
    description: toTextOrNull(product.text_fields?.description),
    weight: toPositiveOrNull(product.weight),
    height: toPositiveOrNull(product.height),
    width: toPositiveOrNull(product.width),
    length: toPositiveOrNull(product.length),
    images,
    thumbnail: images[0] ?? null,
    options: productOptions,
    options_from_features: resolved.fromFeatures,
    variants,
  };
};

/**
 * Maps a whole getInventoryProductsData response.
 *
 * Products are sorted by id so handle suffixes are assigned deterministically -
 * otherwise two runs could swap which of a colliding pair gets "-2".
 */
export const mapBaseProducts = (
  products: Record<string, BaseProduct>,
  options: MapProductOptions
): MappedProduct[] => {
  const takenHandles = options.takenHandles ?? new Set<string>();

  return Object.entries(products ?? {})
    .sort(([a], [b]) => toNumber(a) - toNumber(b))
    .map(([id, product]) =>
      mapBaseProduct(id, product, { ...options, takenHandles })
    );
};
