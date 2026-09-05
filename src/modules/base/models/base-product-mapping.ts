import { model } from "@medusajs/framework/utils";

/**
 * Links a Base product to the Medusa product created from it.
 *
 * Medusa's `external_id` could hold the Base id on its own, but a dedicated
 * mapping also records when the product was last synced, which the incremental
 * catalog sync needs, and survives a product being recreated in Medusa.
 */
export const BaseProductMapping = model.define("base_product_mapping", {
  id: model.id().primaryKey(),
  base_product_id: model.text().unique(),
  medusa_product_id: model.text().unique(),
  /** Handle assigned at import time, kept to detect renames in Base. */
  handle: model.text(),
  last_synced_at: model.dateTime().nullable(),
});
