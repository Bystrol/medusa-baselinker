import type { MedusaContainer } from "@medusajs/framework/types";

import { syncBaseOrderStatusWorkflow } from "../workflows/sync-base-order-status";
import { isJobDisabled, scheduleFromEnv } from "../lib/job-schedule";

/**
 * Order status and tracking coming back from Base.
 *
 * Read-only against Base, so the schedule is bounded only by how quickly a
 * customer should see a tracking number appear.
 */
export default async function syncBaseOrderStatusJob(
  container: MedusaContainer
) {
  if (isJobDisabled("BASE_ORDER_SYNC_CRON")) return;

  await syncBaseOrderStatusWorkflow(container).run();
}

export const config = {
  name: "sync-base-order-status",
  schedule: scheduleFromEnv("BASE_ORDER_SYNC_CRON", "*/10 * * * *"),
};
