import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { syncBaseCatalogWorkflow } from "../../../../workflows/sync-base-catalog";

/**
 * Runs a full catalog sync from Base on demand.
 *
 * A scheduled job covers the routine case; this exists so an operator can
 * force a sync after changing something in Base without waiting for the next
 * tick, and so the workflow can be exercised directly during development.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await syncBaseCatalogWorkflow(req.scope).run();

  res.json({
    message: "Base.com catalog synchronized",
    result,
  });
}
