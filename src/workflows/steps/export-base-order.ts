import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import {
  toBaseOrderPayload,
  toOrderLine,
  type OrderLine,
} from "../../lib/order-mapper";

export interface ExportBaseOrderInput {
  orderId: string;
}

export interface ExportBaseOrderResult {
  /** True when this run sent the order to Base. */
  exported: boolean;
  /** True when the order already carried a Base id and was left alone. */
  skipped: boolean;
  baseOrderId?: string;
  /** Set when the export could not proceed; also stored on the mapping. */
  error?: string;
}

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "created_at",
  "shipping_address.*",
  "billing_address.*",
  "shipping_methods.*",
  "items.*",
  // Quantity lives on the order-item detail, not on the line item itself:
  // asking for items.quantity returns nothing at all.
  "items.detail.*",
  "items.tax_lines.*",
];

/**
 * Sends a Medusa order to Base.
 *
 * Base has no idempotency key: calling addOrder twice for the same order
 * creates two orders and there is no API to delete either. So the mapping row
 * is written before the call, not after, and an order that already carries a
 * base_order_id is skipped outright. That makes a retry - whether from a
 * failed subscriber, a redelivered event or an operator - safe by default.
 *
 * Failures are recorded on the mapping instead of thrown. A missing variant
 * mapping or a rejected payload is a data problem that will not fix itself on
 * the next attempt, and letting it bubble would only bury it in a subscriber
 * stack trace. export_error keeps it visible and the admin route can retry
 * once the cause is dealt with.
 */
export const exportBaseOrderStep = createStep(
  "export-base-order",
  async ({ orderId }: ExportBaseOrderInput, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const [existing] = await baseService.listBaseOrderMappings({
      medusa_order_id: orderId,
    });

    if (existing?.base_order_id) {
      logger.info(
        `Base.com: order ${orderId} already exported as ${existing.base_order_id}`
      );
      return new StepResponse<ExportBaseOrderResult>({
        exported: false,
        skipped: true,
        baseOrderId: existing.base_order_id,
      });
    }

    // Reserve the mapping before doing anything that could partially succeed.
    const mapping =
      existing ??
      (
        await baseService.createBaseOrderMappings([
          { medusa_order_id: orderId },
        ])
      )[0];

    const fail = async (reason: string) => {
      logger.error(`Base.com: order ${orderId} not exported - ${reason}`);
      await baseService.updateBaseOrderMappings({
        id: mapping.id,
        export_error: reason,
      });
      return new StepResponse<ExportBaseOrderResult>({
        exported: false,
        skipped: false,
        error: reason,
      });
    };

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { id: orderId },
    });

    const order = (orders as any[])[0];
    if (!order) return fail("the order could not be read from Medusa");

    const items = (order.items ?? []) as any[];
    if (!items.length) return fail("the order has no line items");

    const variantIds = items
      .map((item) => item.variant_id)
      .filter((id): id is string => !!id);

    const variantMappings = await baseService.listBaseVariantMappings({
      medusa_variant_id: variantIds,
    });
    // The mapping is also where the ean comes from: an order line carries the
    // sku but not the ean.
    const mappingByVariant = new Map(
      variantMappings.map((entry) => [entry.medusa_variant_id, entry])
    );

    const lines: OrderLine[] = [];
    for (const item of items) {
      const mapped = mappingByVariant.get(item.variant_id);

      // Exporting a partial order would understate what the warehouse has to
      // ship, which is worse than not exporting it at all.
      if (!mapped) {
        return fail(
          `line "${item.title}" has no Base mapping - run a catalog sync first`
        );
      }

      lines.push(toOrderLine(item, mapped.base_variant_id, mapped.ean));
    }

    const shippingMethods = (order.shipping_methods ?? []) as any[];
    const inventoryId = await baseService.getInventoryId();

    const payload = toBaseOrderPayload({
      medusa_order_id: order.id,
      display_id: order.display_id,
      created_at: order.created_at,
      currency_code: order.currency_code,
      email: order.email,
      shipping_address: order.shipping_address,
      billing_address: order.billing_address,
      shipping_method_name: shippingMethods
        .map((method) => method.name)
        .join(", "),
      shipping_price: shippingMethods.reduce(
        (sum, method) => sum + Number(method.amount ?? 0),
        0
      ),
      lines,
      storage_id: `bl_${inventoryId}`,
      order_status_id: await baseService.getOrderStatusId(),
      custom_source_id: baseService.options.custom_source_id,
    });

    let baseOrderId: string;
    try {
      baseOrderId = await baseService.addOrder(payload);
    } catch (error) {
      return fail((error as Error).message);
    }

    if (!baseOrderId) return fail("Base accepted the order but returned no id");

    await baseService.updateBaseOrderMappings({
      id: mapping.id,
      base_order_id: baseOrderId,
      exported_at: new Date(),
      export_error: null,
    });

    logger.info(`Base.com: exported order ${orderId} as ${baseOrderId}`);

    return new StepResponse<ExportBaseOrderResult>({
      exported: true,
      skipped: false,
      baseOrderId,
    });
  }
);
