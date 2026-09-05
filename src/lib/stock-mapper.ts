/**
 * Maps Base stock responses onto per-variant available quantities.
 *
 * Kept separate from the catalog mapper because the stock-only sync runs far
 * more often: getInventoryProductsStock returns the whole inventory, variants
 * included, in a single call, while getInventoryProductsData needs the full
 * catalog payload in batches of a thousand.
 */

import type { BaseProductStock, BaseStockMap } from "./base-types";
import { toNumber } from "./coerce";

/** Available quantity per Base warehouse key ("bl_153201"). */
export type WarehouseQuantities = Record<string, number>;

/** Available quantities keyed by Base variant id. */
export type VariantStock = Record<string, WarehouseQuantities>;

/**
 * Available stock is what Base holds minus what it has already reserved.
 *
 * Syncing the raw figure would publish goods that Base has committed to
 * orders awaiting fulfillment, which is how a store oversells.
 */
const available = (
  stock: BaseStockMap | undefined,
  reservations: BaseStockMap | undefined
): WarehouseQuantities => {
  const result: WarehouseQuantities = {};

  for (const [warehouse, quantity] of Object.entries(stock ?? {})) {
    const reserved = toNumber((reservations ?? {})[warehouse]);
    result[warehouse] = Math.max(0, toNumber(quantity) - reserved);
  }

  return result;
};

/**
 * Base reports `variant_reservations` as an empty array when there are none
 * and as an object keyed by variant id otherwise.
 */
const variantReservations = (
  entry: BaseProductStock,
  variantId: string
): BaseStockMap | undefined => {
  const reservations = entry.variant_reservations;
  if (!reservations || Array.isArray(reservations)) return undefined;
  return (reservations as Record<string, BaseStockMap>)[variantId];
};

/**
 * Flattens a getInventoryProductsStock response into per-variant quantities.
 *
 * A product with variants contributes one entry per variant and none for
 * itself: Base reports the parent's stock as the sum of its variants, so
 * emitting both would double count. A product without variants contributes a
 * single entry under its own id, matching the synthesized variant the catalog
 * mapper creates for it.
 */
export const mapStockResponse = (
  products: Record<string, BaseProductStock>
): VariantStock => {
  const result: VariantStock = {};

  for (const [productId, entry] of Object.entries(products ?? {})) {
    const variants = Object.entries(entry?.variants ?? {});

    if (!variants.length) {
      result[productId] = available(entry?.stock, entry?.reservations);
      continue;
    }

    for (const [variantId, stock] of variants) {
      result[variantId] = available(
        stock,
        variantReservations(entry, variantId)
      );
    }
  }

  return result;
};

/** Total available quantity across every warehouse, for logging and guards. */
export const totalQuantity = (quantities: WarehouseQuantities): number =>
  Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
