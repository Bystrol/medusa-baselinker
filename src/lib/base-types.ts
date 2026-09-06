/**
 * Base.com API shapes, transcribed from responses recorded in fixtures/.
 *
 * The published documentation and the live API disagree in several places;
 * these follow the API - see the notes inline.
 *
 * Numeric fields are typed as `unknown` wherever the API has been observed to
 * switch between number and string. Read them through src/lib/coerce.ts.
 */

/**
 * A Base inventory - the catalog products belong to.
 *
 * `warehouses` and `price_groups` list what this inventory accepts; writing
 * stock to a warehouse it does not list is rejected by the API.
 */
export interface BaseInventory {
  inventory_id: number;
  name: string;
  description: string;
  languages: string[];
  default_language: string;
  price_groups: number[];
  default_price_group: number;
  /** Composite warehouse keys, e.g. "bl_153201". */
  warehouses: string[];
  default_warehouse: string;
  reservations: boolean;
  is_default: boolean;
}

export interface BasePriceGroup {
  price_group_id: number;
  name: string;
  description: string | null;
  currency: string;
  is_default: boolean;
  price_group_type: string;
}

export interface BaseWarehouse {
  /** Prefix of the composite id used everywhere else, e.g. "bl". */
  warehouse_type: string;
  warehouse_id: number;
  internal_warehouse_id: number;
  name: string;
  description: string | null;
  stock_edition: boolean;
  is_default: boolean;
  address: string;
  postcode: string;
  city: string;
  country: string;
}

/**
 * Stock and price maps are keyed by `<warehouse_type>_<warehouse_id>`
 * ("bl_153201"), not by the bare numeric id.
 */
export const warehouseKey = (warehouse: BaseWarehouse): string =>
  `${warehouse.warehouse_type}_${warehouse.warehouse_id}`;

/** Prices keyed by price group id. Values may be numbers or numeric strings. */
export type BasePriceMap = Record<string, unknown>;

/** Quantities keyed by warehouse key. */
export type BaseStockMap = Record<string, unknown>;

/**
 * A variant as returned nested inside its parent product.
 *
 * Note the asymmetry: variants are *written* as standalone products carrying
 * `parent_id`, but *read back* nested here, and getInventoryProductsList omits
 * them entirely. A variant only carries its own identity, stock and prices -
 * tax rate, dimensions, description and images are inherited from the parent.
 */
export interface BaseVariant {
  name: string;
  ean: string;
  asin: string;
  sku: string;
  stock: BaseStockMap;
  locations: Record<string, string>;
  prices: BasePriceMap;
}

/**
 * A product from getInventoryProductsData.
 *
 * The product id is the *key* in the response object, not a field on the
 * product itself, so it has to be threaded through separately.
 */
export interface BaseProduct {
  is_bundle: boolean;
  ean: string;
  asin: string;
  /** 0 for top-level products; set on products created as variants. */
  parent_id: number;
  sku: string;
  tags: string[];
  tax_rate: unknown;
  weight: unknown;
  height: unknown;
  width: unknown;
  length: unknown;
  star: number;
  category_id: number;
  manufacturer_id: number;
  text_fields: {
    name?: string;
    description?: string;
    [key: string]: unknown;
  };
  /** For a product with variants this is the *sum* of its variants' stock. */
  stock: BaseStockMap;
  reservations: BaseStockMap;
  thresholds: BaseStockMap;
  incoming: BaseStockMap;
  prices: BasePriceMap;
  locations: Record<string, string>;
  links: Record<string, unknown>;
  average_cost: number;
  average_landed_cost: number;
  /** Keyed by position, starting at "1". */
  images: Record<string, string>;
  videos: Record<string, string>;
  /** Null - not an empty object - when the product has no variants. */
  variants: Record<string, BaseVariant> | null;
}

/**
 * An entry from getInventoryProductsList.
 *
 * The id field is `id`, not `product_id` as the rest of the API would suggest,
 * and the list contains parent products only.
 */
export interface BaseProductListItem {
  id: number;
  ean: string;
  asin: string;
  sku: string;
  name: string;
  parent_id: number;
  stock: BaseStockMap;
  prices: BasePriceMap;
}

/**
 * An entry from getInventoryProductsStock - the cheap endpoint used by the
 * frequent stock-only sync. Unlike getInventoryProductsData it exposes
 * per-variant stock without pulling the whole catalog payload.
 */
export interface BaseProductStock {
  product_id: number;
  stock: BaseStockMap;
  reservations: BaseStockMap;
  variants?: Record<string, BaseStockMap>;
  variant_reservations?: Record<string, BaseStockMap> | unknown[];
}
