import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createProductsWorkflow,
  deleteProductsWorkflow,
} from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import type { MappedProduct } from "../../lib/product-mapper";
import { toProductPayload } from "../../lib/medusa-payload";
import {
  resolveSalesChannelId,
  resolveShippingProfileId,
} from "../resolve-defaults";

export interface CreateBaseProductsInput {
  products: MappedProduct[];
}

interface CompensationData {
  createdProductIds: string[];
  createdMappingIds: string[];
  createdVariantMappingIds: string[];
}

/**
 * Creates the Medusa products for Base products that have no mapping yet.
 *
 * Products are created in batches rather than one workflow run per product,
 * and every variant is created with its parent, so a product never exists in
 * an intermediate state with no purchasable variant.
 */
export const createBaseProductsStep = createStep(
  "create-base-products",
  async ({ products }: CreateBaseProductsInput, { container }) => {
    const empty: CompensationData = {
      createdProductIds: [],
      createdMappingIds: [],
      createdVariantMappingIds: [],
    };

    if (!products.length) {
      return new StepResponse({ created: 0 }, empty);
    }

    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    const salesChannelId = await resolveSalesChannelId(container);
    const shippingProfileId = await resolveShippingProfileId(container);

    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: products.map((product) =>
          toProductPayload(product, { salesChannelId, shippingProfileId })
        ),
      },
    });

    const createdProductIds = result.map((product: { id: string }) => product.id);

    // The workflow preserves input order, which is what ties each created
    // product back to the Base product it came from.
    const productMappings = await baseService.createBaseProductMappings(
      products.map((product, index) => ({
        base_product_id: product.base_product_id,
        medusa_product_id: result[index].id,
        handle: product.handle,
        last_synced_at: new Date(),
      }))
    );

    const variantMappings = await baseService.createBaseVariantMappings(
      products.flatMap((product, index) =>
        product.variants.map((variant) => {
          const created = result[index].variants.find(
            (candidate: { title: string }) => candidate.title === variant.title
          );

          return {
            base_variant_id: variant.base_variant_id,
            base_product_id: variant.base_product_id,
            medusa_variant_id: created?.id ?? "",
            sku: variant.sku,
            ean: variant.ean,
            is_synthetic: variant.is_synthetic,
          };
        })
      )
    );

    logger.info(`Base.com: created ${result.length} products in Medusa`);

    return new StepResponse(
      { created: result.length },
      {
        createdProductIds,
        createdMappingIds: productMappings.map((mapping) => mapping.id),
        createdVariantMappingIds: variantMappings.map((mapping) => mapping.id),
      }
    );
  },
  async (data, { container }) => {
    if (!data) return;

    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    if (data.createdVariantMappingIds.length) {
      await baseService.deleteBaseVariantMappings(data.createdVariantMappingIds);
    }
    if (data.createdMappingIds.length) {
      await baseService.deleteBaseProductMappings(data.createdMappingIds);
    }
    if (data.createdProductIds.length) {
      await deleteProductsWorkflow(container).run({
        input: { ids: data.createdProductIds },
      });
    }
  }
);
