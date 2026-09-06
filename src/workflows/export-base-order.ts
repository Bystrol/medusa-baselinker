import {
  createWorkflow,
  WorkflowResponse,
  type WorkflowData,
} from "@medusajs/framework/workflows-sdk";

import { exportBaseOrderStep } from "./steps/export-base-order";

export interface ExportBaseOrderWorkflowInput {
  orderId: string;
}

/**
 * Sends one Medusa order to Base.
 *
 * Triggered by the order.placed subscriber, and exposed as an admin route so
 * an order whose first attempt failed can be retried once the cause is fixed.
 */
export const exportBaseOrderWorkflow = createWorkflow(
  "export-base-order",
  function (input: WorkflowData<ExportBaseOrderWorkflowInput>) {
    const result = exportBaseOrderStep(input);

    return new WorkflowResponse(result);
  }
);
