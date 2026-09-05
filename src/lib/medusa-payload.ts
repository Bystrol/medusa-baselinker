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

export const toVariantPayload = (variant: MappedVariant, optionTitle: string) => ({
  title: variant.title,
  sku: variant.sku ?? undefined,
  ean: variant.ean ?? undefined,
  // Base owns the stock, so Medusa has to track it rather than treat the
  // variant as always available.
  manage_inventory: true,
  options: { [optionTitle]: variant.option_value },
  prices: variant.prices.map((price) => ({
    amount: price.amount,
    currency_code: price.currency_code,
  })),
});

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
    toVariantPayload(variant, product.option_title)
  ),
  ...(context.salesChannelId
    ? { sales_channels: [{ id: context.salesChannelId }] }
    : {}),
  ...(context.shippingProfileId
    ? { shipping_profile_id: context.shippingProfileId }
    : {}),
});
