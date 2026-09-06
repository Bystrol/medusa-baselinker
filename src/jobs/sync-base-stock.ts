import type { MedusaContainer } from "@medusajs/framework/types";

import { syncBaseStockWorkflow } from "../workflows/sync-base-stock";
import { isJobDisabled, scheduleFromEnv } from "../lib/job-schedule";

/**
 * Stock-only sync.
 *
 * The most frequent of the three: stock is the figure that goes stale fastest
 * and the one that costs a refund when it does. One request covers the whole
 * inventory, variants included, so a tight schedule stays cheap.
 */
export default async function syncBaseStockJob(container: MedusaContainer) {
  if (isJobDisabled("BASE_STOCK_SYNC_CRON")) return;

  await syncBaseStockWorkflow(container).run();
}

export const config = {
  name: "sync-base-stock",
  schedule: scheduleFromEnv("BASE_STOCK_SYNC_CRON", "*/15 * * * *"),
};
