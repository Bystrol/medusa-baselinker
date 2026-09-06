import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { syncBaseStockWorkflow } from "../../../../workflows/sync-base-stock";

/**
 * Runs a stock-only sync on demand, without touching the catalog.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await syncBaseStockWorkflow(req.scope).run();

  res.json({ message: "Base.com stock synchronized", result });
}
