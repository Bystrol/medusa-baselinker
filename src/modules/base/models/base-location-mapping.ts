import { model } from "@medusajs/framework/utils";

/**
 * Links a Base warehouse to a Medusa stock location.
 *
 * The Base side is the composite key used throughout the API
 * ("bl_153201"), not the bare numeric warehouse id.
 */
export const BaseLocationMapping = model.define("base_location_mapping", {
  id: model.id().primaryKey(),
  base_warehouse_id: model.text().unique(),
  medusa_location_id: model.text().index(),
  name: model.text(),
});
