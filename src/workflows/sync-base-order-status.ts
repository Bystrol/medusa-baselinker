import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { syncBaseOrderStatusStep } from "./steps/sync-base-order-status";

/**
 * Pulls order status and tracking from Base back into Medusa.
 *
 * Read-only against Base, so it can run as often as the schedule allows
 * without any risk of creating shipments or incurring carrier charges.
 */
export const syncBaseOrderStatusWorkflow = createWorkflow(
  "sync-base-order-status",
  function () {
    const result = syncBaseOrderStatusStep();

    return new WorkflowResponse(result);
  }
);
