/**
 * Turns a mapped Base product into the payloads Medusa's core workflows expect.
 *
 * Kept out of the workflow steps so the exact shape sent to Medusa stays
 * testable without a running application.
 */

import type { MappedProduct, MappedVariant } from "./product-mapper";

export interface PayloadContext {
  salesChannelId?: string;
  shippingProfileId?: string;
}

/**
 * Fields shared by both directions. `options` is deliberately absent: it is
 * required when creating a variant and destructive when updating one.
 */
const variantFields = (variant: MappedVariant) => ({
  title: variant.title,
  sku: variant.sku ?? undefined,
  ean: variant.ean ?? undefined,
  // Base owns the stock, so Medusa has to track it rather than treat the
  // variant as always available.
  manage_inventory: true,
  prices: variant.prices.map((price) => ({
    amount: price.amount,
    currency_code: price.currency_code,
  })),
});

export const toVariantCreatePayload = (
  variant: MappedVariant,
  optionTitle: string
) => ({
  ...variantFields(variant),
  options: { [optionTitle]: variant.option_value },
});

/**
 * Update payload, without `options`.
 *
 * Passing options to updateProductVariantsWorkflow does not re-link the
 * variant - it rebuilds the option's value list, which deletes the values
 * every variant of the product is pointing at and fails the run with
 * "Option value ... does not exist for option ...". The link does not need
 * updating anyway: it is established at creation and the value only changes
 * if the variant is renamed upstream.
 */
export const toVariantUpdatePayload = (variant: MappedVariant) =>
  variantFields(variant);

export const toProductPayload = (
  product: MappedProduct,
  context: PayloadContext = {}
) => ({
  title: product.title,
  handle: product.handle,
  description: product.description ?? undefined,
  status: "published" as const,
  external_id: product.base_product_id,
  weight: product.weight ?? undefined,
  height: product.height ?? undefined,
  width: product.width ?? undefined,
  length: product.length ?? undefined,
  images: product.images.map((url) => ({ url })),
  thumbnail: product.thumbnail ?? undefined,
  // Medusa refuses to create a product without options.
  options: [
    {
      title: product.option_title,
      values: product.variants.map((variant) => variant.option_value),
    },
  ],
  variants: product.variants.map((variant) =>
    toVariantCreatePayload(variant, product.option_title)
  ),
  ...(context.salesChannelId
    ? { sales_channels: [{ id: context.salesChannelId }] }
    : {}),
  ...(context.shippingProfileId
    ? { shipping_profile_id: context.shippingProfileId }
    : {}),
});
