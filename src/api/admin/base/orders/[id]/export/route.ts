import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { exportBaseOrderWorkflow } from "../../../../../../workflows/export-base-order";

/**
 * Retries the export of a single order.
 *
 * An order already carrying a Base id is skipped rather than duplicated, so
 * this is safe to call repeatedly - useful once whatever caused the first
 * failure, usually a missing catalog mapping, has been dealt with.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await exportBaseOrderWorkflow(req.scope).run({
    input: { orderId: req.params.id },
  });

  res.json({ message: "Base.com order export completed", result });
}
