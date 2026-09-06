import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { fetchBaseStockStep } from "./steps/fetch-base-stock";
import { syncInventoryLevelsStep } from "./steps/sync-inventory-levels";

/**
 * Stock-only sync, meant to run far more often than the catalog one.
 *
 * Stock is the figure that goes stale fastest and the one that hurts most
 * when it does - an oversold order costs a refund and a customer. Catalog
 * data changes rarely by comparison, so it is not worth pulling on the same
 * schedule.
 *
 * Variants Base knows about but Medusa has not imported yet are skipped
 * rather than treated as an error; the next catalog sync brings them in.
 */
export const syncBaseStockWorkflow = createWorkflow(
  "sync-base-stock",
  function () {
    const { stockByVariant } = fetchBaseStockStep();
    const result = syncInventoryLevelsStep({ stockByVariant });

    return new WorkflowResponse(result);
  }
);
