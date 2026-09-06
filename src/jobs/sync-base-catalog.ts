import type { MedusaContainer } from "@medusajs/framework/types";

import { syncBaseCatalogWorkflow } from "../workflows/sync-base-catalog";
import { isJobDisabled, scheduleFromEnv } from "../lib/job-schedule";

/**
 * Full catalog import.
 *
 * Runs rarely by comparison with stock: product names, prices and images
 * change occasionally, while a full pass costs one request per thousand
 * products plus another per thousand variants.
 */
export default async function syncBaseCatalogJob(container: MedusaContainer) {
  if (isJobDisabled("BASE_CATALOG_SYNC_CRON")) return;

  await syncBaseCatalogWorkflow(container).run();
}

export const config = {
  name: "sync-base-catalog",
  schedule: scheduleFromEnv("BASE_CATALOG_SYNC_CRON", "0 */6 * * *"),
};
