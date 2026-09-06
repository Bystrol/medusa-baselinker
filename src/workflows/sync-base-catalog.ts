import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { fetchBaseCatalogStep } from "./steps/fetch-base-catalog";
import { syncStockLocationsStep } from "./steps/sync-stock-locations";
import { splitProductsByMappingStep } from "./steps/split-products-by-mapping";
import { createBaseProductsStep } from "./steps/create-base-products";
import { updateBaseProductsStep } from "./steps/update-base-products";
import { applyMissingProductsStep } from "./steps/apply-missing-products";
import { syncInventoryLevelsStep } from "./steps/sync-inventory-levels";

/**
 * Full catalog sync from Base into Medusa.
 *
 * Order matters: stock locations exist before any product references them,
 * products are split by mapping before being written so creates and updates
 * stay separate, and withdrawals are applied last, once the sync has proven it
 * can reach Base and read a plausible catalog.
 */
export const syncBaseCatalogWorkflow = createWorkflow(
  "sync-base-catalog",
  function () {
    const catalog = fetchBaseCatalogStep();

    syncStockLocationsStep();

    const split = splitProductsByMappingStep({ products: catalog.products });

    const created = createBaseProductsStep({ products: split.toCreate });
    const updated = updateBaseProductsStep({ products: split.toUpdate });
    const withdrawn = applyMissingProductsStep({
      seenBaseProductIds: catalog.seenBaseProductIds,
    });

    // `after` carries no data; it exists so the engine schedules this step
    // once the products are written, rather than alongside them.
    const stock = syncInventoryLevelsStep({
      stockByVariant: catalog.stockByVariant,
      after: [created, updated],
    });

    return new WorkflowResponse({ created, updated, withdrawn, stock });
  }
);
