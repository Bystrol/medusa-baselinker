import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";

import { exportBaseOrderWorkflow } from "../workflows/export-base-order";

/**
 * Exports every placed order to Base.
 *
 * The workflow records its own failures rather than throwing, so a data
 * problem on one order neither retries forever nor disappears - it lands in
 * base_order_mapping.export_error, where the admin route can pick it up.
 */
export default async function baseOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await exportBaseOrderWorkflow(container).run({
    input: { orderId: data.id },
  });
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
