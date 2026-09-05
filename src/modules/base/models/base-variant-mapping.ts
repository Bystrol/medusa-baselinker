import { model } from "@medusajs/framework/utils";

/**
 * Links a Base variant to a Medusa product variant.
 *
 * `base_variant_id` is a Base product id in its own right: variants are
 * written as standalone products carrying `parent_id`, and for a product Base
 * holds without variants it equals `base_product_id`.
 *
 * The order export relies on this: a line item is sent to Base under the
 * variant's own product id, so the mapping has to survive independently of
 * the parent.
 */
export const BaseVariantMapping = model.define("base_variant_mapping", {
  id: model.id().primaryKey(),
  base_variant_id: model.text().unique(),
  base_product_id: model.text().index(),
  medusa_variant_id: model.text().unique(),
  sku: model.text().nullable(),
  ean: model.text().nullable(),
  /** True when Base has no variants and this one was synthesized on import. */
  is_synthetic: model.boolean().default(false),
});
