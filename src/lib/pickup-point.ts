/**
 * Finds the pickup point a customer chose, in the data a carrier plugin left
 * on the shipping method.
 *
 * Base reads the locker or pickup point from the order's `delivery_point_id`,
 * not from the parcel form: getCourierFields for the InPost locker courier
 * lists service, size, cash on delivery and insurance, and nothing for the
 * point. So without this field on the order, Base cannot create the shipment
 * and someone has to paste the locker id by hand for every parcel.
 *
 * Where the id sits is up to whichever plugin handled the checkout - there is
 * no convention across carriers - so the keys are configuration rather than
 * something to guess. Nothing here is specific to any carrier.
 */

import { toText } from "./coerce";

/** Keys checked when none are configured, covering the common cases. */
export const DEFAULT_PICKUP_POINT_KEYS = [
  "target_point",
  "point_id",
  "pickup_point_id",
];

/**
 * Reads a value by a dotted path, so a plugin nesting the id under an object
 * (`point.id`) is reachable without special handling.
 */
const valueAt = (
  source: Record<string, unknown> | null | undefined,
  path: string
): unknown => {
  let current: unknown = source;

  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

/**
 * Returns the first non-empty value found under the given keys, or null.
 *
 * Order matters: the keys are tried as listed, so a merchant can put their
 * own carrier's key first.
 */
export const extractPickupPointId = (
  data: Record<string, unknown> | null | undefined,
  keys: string[] = DEFAULT_PICKUP_POINT_KEYS
): string | null => {
  for (const key of keys) {
    const value = toText(valueAt(data, key));
    if (value !== "") return value;
  }

  return null;
};

/**
 * Picks the point from an order's shipping methods.
 *
 * An order can carry several shipping methods, but only one of them will name
 * a point - a parcel goes to one place - so the first hit wins.
 */
export const findPickupPointId = (
  shippingMethods: { data?: Record<string, unknown> | null }[] | null | undefined,
  keys: string[] = DEFAULT_PICKUP_POINT_KEYS
): string | null => {
  for (const method of shippingMethods ?? []) {
    const id = extractPickupPointId(method?.data, keys);
    if (id) return id;
  }

  return null;
};
