import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { syncBaseOrderStatusWorkflow } from "../../../../../workflows/sync-base-order-status";

/**
 * Pulls order status and tracking from Base on demand.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await syncBaseOrderStatusWorkflow(req.scope).run();

  res.json({ message: "Base.com order status synchronized", result });
}
