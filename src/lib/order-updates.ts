/**
 * Works out what changed on the Base side of orders Medusa already exported.
 *
 * Base offers no "modified since" filter - getOrders can only be narrowed by
 * confirmation date - so the sync re-reads a recent window and diffs it
 * against what was last seen. That makes the comparison the important part:
 * without it every poll would rewrite orders that had not moved.
 */

import { toText } from "./coerce";

export interface OrderMappingState {
  medusa_order_id: string;
  base_order_id: string;
  /** Base status id recorded at the last sync. */
  base_status_id?: string | null;
  /** Tracking number recorded at the last sync. */
  tracking_number?: string | null;
  /** Set once a fulfillment exists in Medusa for this order. */
  fulfilled_at?: Date | string | null;
}

export interface BaseOrderState {
  order_id: unknown;
  order_status_id?: unknown;
  /** Tracking number, exposed directly on the order rather than only on the package. */
  delivery_package_nr?: unknown;
  /** Courier code, "other" for manually attached parcels. */
  delivery_package_module?: unknown;
}

export interface OrderUpdate {
  medusa_order_id: string;
  base_order_id: string;
  status_id: string;
  tracking_number: string | null;
  courier_code: string | null;
  /** True when the status or the tracking number differs from what was stored. */
  changed: boolean;
  /**
   * True when Medusa should record a fulfillment: the order looks shipped and
   * does not already have one.
   */
  should_fulfill: boolean;
}

export interface PlanOrderUpdatesInput {
  mappings: OrderMappingState[];
  baseOrders: BaseOrderState[];
  /**
   * Base status ids that mean the order left the warehouse. Optional: a
   * tracking number is treated as shipped on its own, which covers the common
   * case without forcing every merchant to map account-specific status ids.
   */
  shippedStatusIds?: string[];
}

export const planOrderUpdates = ({
  mappings,
  baseOrders,
  shippedStatusIds = [],
}: PlanOrderUpdatesInput): OrderUpdate[] => {
  const shipped = new Set(shippedStatusIds.map(String));

  const byBaseId = new Map(
    baseOrders.map((order) => [toText(order.order_id), order])
  );

  const updates: OrderUpdate[] = [];

  for (const mapping of mappings) {
    const order = byBaseId.get(toText(mapping.base_order_id));

    // Orders outside the polled window, or removed from Base entirely, simply
    // do not appear. Leaving them untouched is the only safe reading: their
    // absence says nothing about their state.
    if (!order) continue;

    const statusId = toText(order.order_status_id);
    const trackingNumber = toText(order.delivery_package_nr) || null;
    const courierCode = toText(order.delivery_package_module) || null;

    const statusChanged = statusId !== toText(mapping.base_status_id);
    const trackingChanged =
      trackingNumber !== (toText(mapping.tracking_number) || null);

    const looksShipped = !!trackingNumber || shipped.has(statusId);

    updates.push({
      medusa_order_id: mapping.medusa_order_id,
      base_order_id: toText(mapping.base_order_id),
      status_id: statusId,
      tracking_number: trackingNumber,
      courier_code: courierCode,
      changed: statusChanged || trackingChanged,
      should_fulfill: looksShipped && !mapping.fulfilled_at,
    });
  }

  return updates;
};
