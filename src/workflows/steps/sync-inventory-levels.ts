import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import type { VariantStock } from "../../lib/stock-mapper";

export interface SyncInventoryLevelsInput {
  /** Available quantity per Base warehouse key, keyed by Base variant id. */
  stockByVariant: VariantStock;
  /**
   * Unused, and present only to order this step after the ones it names.
   *
   * The workflow engine derives execution order from data dependencies, so a
   * step reading nothing from the product writes would be free to run
   * alongside them - and would try to stock variants that do not exist yet.
   */
  after?: unknown;
}

/**
 * Writes Base stock into Medusa's inventory levels.
 *
 * Not compensated, and deliberately so. Restoring previous quantities would
 * put back numbers Base has already moved on from, and the stock is Base's to
 * own: the recovery from a failed run is the next run, which is minutes away.
 *
 * Quantities are written, never adjusted by a delta. Anything else drifts:
 * a missed run or a double-applied delta leaves Medusa permanently out of
 * step with the warehouse.
 */
export const syncInventoryLevelsStep = createStep(
  "sync-inventory-levels",
  async ({ stockByVariant }: SyncInventoryLevelsInput, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const inventoryService = container.resolve("inventory");

    const baseVariantIds = Object.keys(stockByVariant);
    if (!baseVariantIds.length) {
      return new StepResponse({ created: 0, updated: 0, skipped: 0 });
    }

    const locationMappings = await baseService.listBaseLocationMappings({});
    const locationByWarehouse = new Map(
      locationMappings.map((mapping) => [
        mapping.base_warehouse_id,
        mapping.medusa_location_id,
      ])
    );

    const variantMappings = await baseService.listBaseVariantMappings({
      base_variant_id: baseVariantIds,
    });
    const medusaVariantByBase = new Map(
      variantMappings.map((mapping) => [
        mapping.base_variant_id,
        mapping.medusa_variant_id,
      ])
    );

    // A variant does not hold its stock directly - it links to an inventory
    // item, and the quantity lives on that item per location.
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: [...medusaVariantByBase.values()] },
    });

    const inventoryItemByVariant = new Map<string, string>(
      (variants as { id: string; inventory_items?: { inventory_item_id: string }[] }[])
        .map((variant) => [
          variant.id,
          variant.inventory_items?.[0]?.inventory_item_id,
        ])
        .filter((entry): entry is [string, string] => !!entry[1])
    );

    const inventoryItemIds = [...inventoryItemByVariant.values()];
    if (!inventoryItemIds.length) {
      logger.warn(
        "Base.com: no inventory items found for the mapped variants - stock not written"
      );
      return new StepResponse({ created: 0, updated: 0, skipped: baseVariantIds.length });
    }

    const existingLevels = await inventoryService.listInventoryLevels({
      inventory_item_id: inventoryItemIds,
    });
    const existing = new Set(
      existingLevels.map(
        (level: { inventory_item_id: string; location_id: string }) =>
          `${level.inventory_item_id}:${level.location_id}`
      )
    );

    const create: {
      inventory_item_id: string;
      location_id: string;
      stocked_quantity: number;
    }[] = [];
    const update: typeof create = [];
    let skipped = 0;
    const unmappedWarehouses = new Set<string>();

    for (const [baseVariantId, quantities] of Object.entries(stockByVariant)) {
      const medusaVariantId = medusaVariantByBase.get(baseVariantId);
      const inventoryItemId = medusaVariantId
        ? inventoryItemByVariant.get(medusaVariantId)
        : undefined;

      // A variant Base knows about but Medusa has not imported yet: the next
      // catalog sync will create it, and the run after that will stock it.
      if (!inventoryItemId) {
        skipped++;
        continue;
      }

      for (const [warehouse, quantity] of Object.entries(quantities)) {
        const locationId = locationByWarehouse.get(warehouse);

        if (!locationId) {
          unmappedWarehouses.add(warehouse);
          continue;
        }

        const level = {
          inventory_item_id: inventoryItemId,
          location_id: locationId,
          stocked_quantity: quantity,
        };

        if (existing.has(`${inventoryItemId}:${locationId}`)) {
          update.push(level);
        } else {
          create.push(level);
        }
      }
    }

    if (unmappedWarehouses.size) {
      logger.warn(
        `Base.com: no stock location mapped for warehouse(s) ${[...unmappedWarehouses].join(", ")} - ` +
          "run a catalog sync to create them"
      );
    }

    if (create.length || update.length) {
      await batchInventoryItemLevelsWorkflow(container).run({
        input: { create, update },
      });
    }

    logger.info(
      `Base.com: inventory levels - ${create.length} created, ${update.length} updated` +
        (skipped ? `, ${skipped} variants not imported yet` : "")
    );

    return new StepResponse({
      created: create.length,
      updated: update.length,
      skipped,
    });
  }
);
