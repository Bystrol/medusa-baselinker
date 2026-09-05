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
  priceGroups: PriceGroup[]
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
  is_synthetic: false,
});

/**
 * Builds the single variant Medusa requires for a product Base holds without
 * any. The u11d plugin skips these products instead, which is issue #2.
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
  const variants = variantEntries.length
    ? variantEntries.map(([variantId, variant]) =>
        mapVariant(variantId, variant, baseProductId, priceGroups)
      )
    : [synthesizeVariant(baseProductId, product, priceGroups)];

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
