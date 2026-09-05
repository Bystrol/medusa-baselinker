import { model } from "@medusajs/framework/utils";

/**
 * Links a Medusa order to the order created for it in Base.
 *
 * Written before anything else during export so a retry can detect that the
 * order already exists: Base has no idempotency key, and a repeated addOrder
 * silently creates a duplicate.
 *
 * The status and tracking columns are what the sync back compares against, so
 * that an unchanged order produces no writes in Medusa.
 */
export const BaseOrderMapping = model.define("base_order_mapping", {
  id: model.id().primaryKey(),
  medusa_order_id: model.text().unique().index(),
  base_order_id: model.text().index().nullable(),
  /** Base status id last seen, so only real changes are acted on. */
  base_status_id: model.text().nullable(),
  tracking_number: model.text().nullable(),
  courier_code: model.text().nullable(),
  /** Set when export failed, so failures are visible instead of silent. */
  export_error: model.text().nullable(),
  exported_at: model.dateTime().nullable(),
  last_synced_at: model.dateTime().nullable(),
});
