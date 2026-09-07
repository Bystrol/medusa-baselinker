/**
 * Maps a Medusa order onto the payload Base's addOrder expects.
 *
 * Pure, like the catalog mappers, so the exact shape sent upstream can be
 * asserted without a running store.
 */

import { toNumber, toText, toTextOrNull } from "./coerce";

export interface OrderAddress {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  province?: string | null;
  country_code?: string | null;
  phone?: string | null;
}

export interface OrderLine {
  /**
   * Base id of the ordered variant.
   *
   * A variant is a product in its own right in Base, so this is what goes in
   * `product_id`; the `variant_id` field stays empty, which is how Base
   * recorded the orders this was verified against.
   */
  base_variant_id: string;
  title: string;
  sku?: string | null;
  ean?: string | null;
  /** Gross price of a single unit, not the line total. */
  unit_price: number;
  /** Tax percentage, e.g. 23. */
  tax_rate: number;
  quantity: number;
}

export interface OrderExportInput {
  medusa_order_id: string;
  display_id?: number | null;
  created_at: Date | string;
  currency_code: string;
  email?: string | null;
  phone?: string | null;
  shipping_address?: OrderAddress | null;
  billing_address?: OrderAddress | null;
  shipping_method_name?: string | null;
  shipping_price?: number;
  lines: OrderLine[];
  /** Inventory the ordered products belong to, as "bl_<inventory_id>". */
  storage_id: string;
  order_status_id?: number;
  custom_source_id?: number;
  /** Payment label shown in Base and used by its automation rules. */
  payment_method?: string;
  /** Whether the courier collects the money on delivery. */
  payment_method_cod?: boolean;
  /**
   * Amount already collected. Not part of this payload: addOrder ignores it,
   * so it is sent separately with setOrderPayment once the order exists.
   */
  payment_done?: number;
  /** Comment the customer left with the order. */
  customer_note?: string | null;
  /**
   * Locker or pickup point the customer chose. Base reads it from the order
   * rather than from the parcel form, so without it the shipment cannot be
   * created automatically.
   */
  pickup_point_id?: string | null;
}

/** Shape of a Medusa order line, narrowed to what the export needs. */
export interface MedusaOrderItem {
  title: string;
  quantity: number;
  unit_price?: number | null;
  /** True when unit_price already includes tax. */
  is_tax_inclusive?: boolean | null;
  variant_sku?: string | null;
  tax_lines?: { rate?: number | null }[] | null;
}

/** Sums the tax lines of an item; normally there is exactly one. */
const taxRateOf = (item: MedusaOrderItem): number =>
  (item.tax_lines ?? []).reduce((sum, line) => sum + toNumber(line?.rate), 0);

/**
 * Builds an export line from a Medusa order item.
 *
 * Base stores a gross unit price. Medusa's `unit_price` is gross only when the
 * region prices tax-inclusively, which `is_tax_inclusive` reports per line, so
 * tax is added when it is not already there.
 *
 * The line total would have been the simpler source, but order line items
 * carry no computed totals when read through the query graph - only the unit
 * price and the tax lines.
 */
export const toOrderLine = (
  item: MedusaOrderItem,
  baseVariantId: string,
  ean?: string | null
): OrderLine => {
  const quantity = toNumber(item.quantity, 1) || 1;
  const rate = taxRateOf(item);
  const net = toNumber(item.unit_price);
  const gross = item.is_tax_inclusive ? net : net * (1 + rate / 100);

  return {
    base_variant_id: baseVariantId,
    title: toText(item.title),
    sku: toTextOrNull(item.variant_sku),
    ean: toTextOrNull(ean),
    // Rounded to cents: floating point multiplication otherwise sends values
    // like 97.17000000000002 upstream.
    unit_price: Math.round(gross * 100) / 100,
    tax_rate: rate,
    quantity,
  };
};

const fullName = (address?: OrderAddress | null): string =>
  [toText(address?.first_name), toText(address?.last_name)]
    .filter((part) => part !== "")
    .join(" ");

/** Base wants seconds, and rejects a millisecond timestamp outright. */
const toUnixSeconds = (value: Date | string): number =>
  Math.floor(new Date(value).getTime() / 1000);

export const toBaseOrderPayload = (
  input: OrderExportInput
): Record<string, unknown> => {
  // Base treats the delivery address as the primary one, and an order without
  // a billing address is common enough that falling back keeps the invoice
  // fields populated rather than empty.
  const shipping = input.shipping_address ?? null;
  const billing = input.billing_address ?? shipping;

  return {
    order_status_id: input.order_status_id,
    custom_source_id: input.custom_source_id,
    date_add: toUnixSeconds(input.created_at),
    currency: toText(input.currency_code).toUpperCase(),
    payment_method: toText(input.payment_method) || "Medusa",
    payment_method_cod: input.payment_method_cod ?? false,
    email: toText(input.email),
    phone: toText(input.phone ?? shipping?.phone),
    user_comments: toText(input.customer_note),
    // The Medusa id is the only durable link back once the order is in Base,
    // and it makes an operator able to find the order from either side.
    admin_comments: `Medusa order ${input.medusa_order_id}`,
    extra_field_1: input.medusa_order_id,

    delivery_method: toText(input.shipping_method_name),
    delivery_price: toNumber(input.shipping_price),
    delivery_fullname: fullName(shipping),
    delivery_company: toText(shipping?.company),
    delivery_address: [toText(shipping?.address_1), toText(shipping?.address_2)]
      .filter((part) => part !== "")
      .join(" "),
    delivery_postcode: toText(shipping?.postal_code),
    delivery_city: toText(shipping?.city),
    delivery_state: toText(shipping?.province),
    delivery_country_code: toText(shipping?.country_code).toUpperCase(),
    delivery_point_id: toText(input.pickup_point_id),

    invoice_fullname: fullName(billing),
    invoice_company: toText(billing?.company),
    invoice_address: [toText(billing?.address_1), toText(billing?.address_2)]
      .filter((part) => part !== "")
      .join(" "),
    invoice_postcode: toText(billing?.postal_code),
    invoice_city: toText(billing?.city),
    invoice_state: toText(billing?.province),
    invoice_country_code: toText(billing?.country_code).toUpperCase(),
    want_invoice: false,

    products: input.lines.map((line) => ({
      storage_id: input.storage_id,
      product_id: line.base_variant_id,
      name: toText(line.title),
      sku: toText(line.sku),
      ean: toTextOrNull(line.ean) ?? undefined,
      // Per unit. Sending the line total would multiply the order value by
      // the quantity, since Base applies the quantity itself.
      price_brutto: toNumber(line.unit_price),
      tax_rate: toNumber(line.tax_rate),
      quantity: toNumber(line.quantity),
    })),
  };
};
