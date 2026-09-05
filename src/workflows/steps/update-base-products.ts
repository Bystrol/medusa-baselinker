import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createProductVariantsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import type { MappedProduct } from "../../lib/product-mapper";
import { toVariantPayload } from "../../lib/medusa-payload";

export interface UpdateBaseProductsInput {
  /** Mapped products paired with the Medusa product they already own. */
  products: { product: MappedProduct; medusaProductId: string }[];
}

/**
 * Refreshes Medusa products that Base already has a mapping for.
 *
 * Deliberately not compensated. Restoring the previous state would mean
 * snapshotting every product before writing, and it would restore data that is
 * by definition stale: Base is the source of truth, so the correct recovery
 * from a failed sync is another sync, not a rollback to older values.
 *
 * The handle is left alone once assigned. Renaming a product in Base should
 * not silently break the storefront URL and whatever links to it.
 */
export const updateBaseProductsStep = createStep(
  "update-base-products",
  async ({ products }: UpdateBaseProductsInput, { container }) => {
    if (!products.length) {
      return new StepResponse({ updated: 0, variantsCreated: 0 });
    }

    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    await updateProductsWorkflow(container).run({
      input: {
        products: products.map(({ product, medusaProductId }) => ({
          id: medusaProductId,
          title: product.title,
          description: product.description ?? undefined,
          weight: product.weight ?? undefined,
          height: product.height ?? undefined,
          width: product.width ?? undefined,
          length: product.length ?? undefined,
          images: product.images.map((url) => ({ url })),
          thumbnail: product.thumbnail ?? undefined,
          // Resent so option values for variants added in Base since the last
          // sync exist before those variants are created.
          options: [
            {
              title: product.option_title,
              values: product.variants.map((variant) => variant.option_value),
            },
          ],
        })),
      },
    });

    const allVariants = products.flatMap(({ product, medusaProductId }) =>
      product.variants.map((variant) => ({ variant, medusaProductId, product }))
    );

    const mappings = await baseService.listBaseVariantMappings({
      base_variant_id: allVariants.map(({ variant }) => variant.base_variant_id),
    });
    const mappedVariants = new Map(
      mappings.map((mapping) => [mapping.base_variant_id, mapping])
    );

    const toUpdate = allVariants.filter(({ variant }) =>
      mappedVariants.has(variant.base_variant_id)
    );
    const toCreate = allVariants.filter(
      ({ variant }) => !mappedVariants.has(variant.base_variant_id)
    );

    if (toUpdate.length) {
      await updateProductVariantsWorkflow(container).run({
        input: {
          product_variants: toUpdate.map(({ variant, product }) => ({
            id: mappedVariants.get(variant.base_variant_id)!.medusa_variant_id,
            ...toVariantPayload(variant, product.option_title),
          })),
        },
      });
    }

    if (toCreate.length) {
      const { result } = await createProductVariantsWorkflow(container).run({
        input: {
          product_variants: toCreate.map(
            ({ variant, product, medusaProductId }) => ({
              product_id: medusaProductId,
              ...toVariantPayload(variant, product.option_title),
            })
          ),
        },
      });

      await baseService.createBaseVariantMappings(
        toCreate.map(({ variant }, index) => ({
          base_variant_id: variant.base_variant_id,
          base_product_id: variant.base_product_id,
          medusa_variant_id: result[index].id,
          sku: variant.sku,
          ean: variant.ean,
          is_synthetic: variant.is_synthetic,
        }))
      );
    }

    const productMappings = await baseService.listBaseProductMappings({
      base_product_id: products.map(({ product }) => product.base_product_id),
    });

    await baseService.updateBaseProductMappings(
      productMappings.map((mapping) => ({
        id: mapping.id,
        last_synced_at: new Date(),
      }))
    );

    logger.info(
      `Base.com: updated ${products.length} products, created ${toCreate.length} new variants`
    );

    return new StepResponse({
      updated: products.length,
      variantsCreated: toCreate.length,
    });
  }
);
