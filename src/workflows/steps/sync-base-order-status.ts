import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import {
  planOrderUpdates,
  type BaseOrderState,
  type OrderUpdate,
} from "../../lib/order-updates";
import { toText } from "../../lib/coerce";

const DEFAULT_LOOKBACK_DAYS = 30;

/** An order line, as far as creating a fulfillment is concerned. */
interface FulfillableItem {
  id: string;
  quantity: number;
}

/**
 * Brings order status and tracking back from Base into Medusa.
 *
 * This closes the loop: without it an order leaves for Base and nothing ever
 * returns, so the customer sees "not fulfilled" forever and has no tracking
 * number, however long ago the parcel actually shipped.
 *
 * Base has no "modified since" filter, so a recent window is re-read on every
 * poll and diffed against what was last recorded. Orders outside the window,
 * or removed upstream, are left alone - their absence says nothing about
 * their state.
 *
 * Nothing here writes to Base. The sync only reads, so it cannot create a
 * shipment or incur a carrier charge.
 */
export const syncBaseOrderStatusStep = createStep(
  "sync-base-order-status",
  async (_input: void, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const mappings = (await baseService.listBaseOrderMappings({})).filter(
      (mapping) => !!mapping.base_order_id
    );

    if (!mappings.length) {
      return new StepResponse({ checked: 0, updated: 0, fulfilled: 0 });
    }

    const lookbackDays =
      baseService.options.order_sync_lookback_days ?? DEFAULT_LOOKBACK_DAYS;
    const since = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

    const baseOrders = await baseService.getOrdersSince(since);

    const updates = planOrderUpdates({
      mappings: mappings.map((mapping) => ({
        medusa_order_id: mapping.medusa_order_id,
        base_order_id: mapping.base_order_id!,
        base_status_id: mapping.base_status_id,
        tracking_number: mapping.tracking_number,
        fulfilled_at: mapping.fulfilled_at,
      })),
      baseOrders: baseOrders as unknown as BaseOrderState[],
      shippedStatusIds: (baseService.options.shipped_status_ids ?? []).map(
        String
      ),
    });

    const changed = updates.filter((update) => update.changed);
    let fulfilled = 0;

    for (const update of updates) {
      let created = false;

      if (update.should_fulfill) {
        created = await fulfillOrder(container, baseService, update);
        if (created) fulfilled++;
      }

      if (!update.changed && !created) continue;

      const mapping = mappings.find(
        (entry) => entry.medusa_order_id === update.medusa_order_id
      )!;

      await baseService.updateBaseOrderMappings({
        id: mapping.id,
        base_status_id: update.status_id,
        tracking_number: update.tracking_number,
        courier_code: update.courier_code,
        last_synced_at: new Date(),
        // Only stamped when the fulfillment really exists. Recording it after
        // a failure would mean the order is never retried.
        ...(created ? { fulfilled_at: new Date() } : {}),
      });
    }

    await baseService.setSyncState(
      "orders_synced_at",
      new Date().toISOString()
    );

    logger.info(
      `Base.com: order status - ${mappings.length} tracked, ${changed.length} changed, ${fulfilled} fulfilled`
    );

    return new StepResponse({
      checked: mappings.length,
      updated: changed.length,
      fulfilled,
    });
  }
);

/**
 * Records a fulfillment in Medusa for an order Base has shipped.
 *
 * The whole order is fulfilled in one go: Base reports shipment at order
 * level, so there is nothing to say which lines went into which parcel.
 */
const fulfillOrder = async (
  container: MedusaContainer,
  baseService: BaseModuleService,
  update: OrderUpdate
): Promise<boolean> => {
  const logger = container.resolve("logger");
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: orders } = await query.graph({
    entity: "order",
    // items.* is required: asking for items.quantity alone returns nothing,
    // and the fulfillment workflow rejects a line without a quantity.
    fields: ["id", "items.*"],
    filters: { id: update.medusa_order_id },
  });

  // Narrowed to the fields requested above, so a rename or a field that
  // quietly resolves to nothing is a type error rather than a runtime one.
  const order = (orders as { id: string; items?: FulfillableItem[] }[])[0];
  const items = order?.items ?? [];

  if (!items.length) {
    logger.warn(
      `Base.com: order ${update.medusa_order_id} has no items to fulfil`
    );
    return false;
  }

  // The tracking url only comes with the package, not the order, so it is
  // fetched once per newly shipped order rather than on every poll.
  let trackingUrl = "";
  if (update.tracking_number) {
    try {
      const packages = await baseService.getOrderPackages(update.base_order_id);
      const match = packages.find(
        (entry) =>
          toText(entry.courier_package_nr) === update.tracking_number
      );
      trackingUrl = toText(match?.tracking_url ?? packages[0]?.tracking_url);
    } catch (error) {
      logger.warn(
        `Base.com: could not read packages for order ${update.base_order_id}: ${
          (error as Error).message
        }`
      );
    }
  }

  try {
    await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: update.medusa_order_id,
        items: items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })),
        ...(update.tracking_number
          ? {
              labels: [
                {
                  tracking_number: update.tracking_number,
                  tracking_url: trackingUrl,
                  label_url: "",
                },
              ],
            }
          : {}),
      },
    });

    logger.info(
      `Base.com: fulfilled order ${update.medusa_order_id}` +
        (update.tracking_number ? ` with tracking ${update.tracking_number}` : "")
    );

    return true;
  } catch (error) {
    // A fulfillment that cannot be created is not a reason to abandon the
    // rest of the poll; the status is still worth recording.
    logger.error(
      `Base.com: could not fulfil order ${update.medusa_order_id}: ${
        (error as Error).message
      }`
    );
    return false;
  }
};
