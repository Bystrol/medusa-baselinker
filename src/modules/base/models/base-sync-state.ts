import { model } from "@medusajs/framework/utils";

/**
 * Cursor storage for incremental syncs.
 *
 * Base's event journal turned out to always be empty, so order status sync
 * polls getOrders with a timestamp instead. That timestamp has to survive
 * restarts, which is what this holds.
 */
export const BaseSyncState = model.define("base_sync_state", {
  id: model.id().primaryKey(),
  key: model.text().unique(),
  value: model.text().nullable(),
});
