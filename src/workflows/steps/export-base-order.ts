import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import {
  toBaseOrderPayload,
  toOrderLine,
  type MedusaOrderItem,
  type OrderAddress,
  type OrderLine,
} from "../../lib/order-mapper";
import { resolvePayment } from "../../lib/payment";
import {
  findPickupPointId,
  DEFAULT_PICKUP_POINT_KEYS,
} from "../../lib/pickup-point";

export interface ExportBaseOrderInput {
  orderId: string;
}

/**
 * The shape query.graph returns for ORDER_FIELDS.
 *
 * Declared here rather than trusting the query to be typed: query.graph
 * returns whatever the requested fields resolve to, and a field that silently
 * resolves to nothing - as items.quantity does without items.* - is exactly
 * the failure this codebase has hit repeatedly.
 */
interface OrderRow {
  id: string;
  display_id?: number | null;
  email?: string | null;
  currency_code: string;
  created_at: string;
  shipping_address?: OrderAddress | null;
  billing_address?: OrderAddress | null;
  shipping_methods?: {
    name?: string | null;
    amount?: number | null;
    /** Carrier-specific payload; where a chosen pickup point ends up. */
    data?: Record<string, unknown> | null;
  }[] | null;
  items?: (MedusaOrderItem & { variant_id?: string | null })[] | null;
  payment_collections?: {
    captured_amount?: number | null;
    payments?: { provider_id?: string | null }[] | null;
  }[] | null;
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
  // Same rule as items.*: naming individual sub-fields returns nothing at all,
  // so the whole shape has to be requested. The order's own payment_status is
  // deliberately absent - it is computed and does not come back at all, which
  // is why the captured amount is the source instead.
  "payment_collections.*",
  "payment_collections.payments.*",
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

    const order = (orders as OrderRow[])[0];
    if (!order) return fail("the order could not be read from Medusa");

    const items = order.items ?? [];
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
      // Medusa allows a line with no variant at all - a custom item added to
      // a draft order. Base has nothing to match it against.
      if (!item.variant_id) {
        return fail(
          `line "${item.title}" has no variant and cannot be matched to a Base product`
        );
      }

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

    const shippingMethods = order.shipping_methods ?? [];
    const inventoryId = await baseService.getInventoryId();

    const collections = order.payment_collections ?? [];
    const payment = resolvePayment({
      // One provider per order in practice; the first payment names it.
      providerId: collections
        .flatMap((collection) => collection.payments ?? [])
        .map((entry) => entry.provider_id)
        .find((id) => !!id),
      capturedAmount: collections.reduce(
        (sum, collection) => sum + Number(collection.captured_amount ?? 0),
        0
      ),
      codProviderIds: baseService.options.cod_payment_providers ?? [],
      labels: baseService.options.payment_method_labels ?? {},
    });

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
      pickup_point_id: findPickupPointId(
        shippingMethods,
        baseService.options.pickup_point_data_keys ?? DEFAULT_PICKUP_POINT_KEYS
      ),
      storage_id: `bl_${inventoryId}`,
      order_status_id: await baseService.getOrderStatusId(),
      custom_source_id: baseService.options.custom_source_id,
      payment_method: payment.payment_method,
      payment_method_cod: payment.payment_method_cod,
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

    // The amount paid needs its own call - addOrder has no field for it. A
    // failure here is logged rather than raised: the order is already in Base,
    // and failing now would leave the export looking unfinished while risking
    // a duplicate on the next attempt.
    if (payment.payment_done > 0) {
      try {
        await baseService.setOrderPayment(baseOrderId, payment.payment_done);
      } catch (error) {
        logger.warn(
          `Base.com: order ${orderId} exported, but recording the ${payment.payment_done} paid failed: ${
            (error as Error).message
          }`
        );
      }
    }

    logger.info(`Base.com: exported order ${orderId} as ${baseOrderId}`);

    return new StepResponse<ExportBaseOrderResult>({
      exported: true,
      skipped: false,
      baseOrderId,
    });
  }
);
