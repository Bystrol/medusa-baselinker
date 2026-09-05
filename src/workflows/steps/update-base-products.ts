import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createProductVariantsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import type { MappedProduct } from "../../lib/product-mapper";
import {
  toVariantCreatePayload,
  toVariantUpdatePayload,
} from "../../lib/medusa-payload";

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
    const productService = container.resolve("product");

    // Options are deliberately left out of the update below.
    //
    // Sending `options` replaces the whole value list rather than adding to
    // it: the existing values are removed and recreated, which detaches every
    // variant already pointing at them and fails the run with "Option value
    // ... does not exist for option ...". Sending the option without its id
    // fails differently, with "Product option with title: ... already exists".
    //
    // So values are only touched when Base actually introduced a new one, and
    // then as the union of what exists and what is new, so nothing in use is
    // dropped.
    const existing = await productService.listProducts(
      { id: products.map(({ medusaProductId }) => medusaProductId) },
      { relations: ["options", "options.values"] }
    );

    type ExistingProduct = {
      id: string;
      options?: { id: string; title: string; values?: { value: string }[] }[];
    };

    const optionByProduct = new Map(
      (existing as ExistingProduct[]).map((product) => [
        product.id,
        product.options?.[0],
      ])
    );

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
        })),
      },
    });

    // Add option values for variants that appeared in Base since the last run.
    const optionsNeedingValues = products.flatMap(
      ({ product, medusaProductId }) => {
        const option = optionByProduct.get(medusaProductId);
        if (!option) return [];

        const current = new Set(
          (option.values ?? []).map((entry) => entry.value)
        );
        const missing = product.variants
          .map((variant) => variant.option_value)
          .filter((value) => !current.has(value));

        if (!missing.length) return [];

        return [
          {
            id: option.id,
            title: option.title,
            values: [...current, ...missing],
          },
        ];
      }
    );

    if (optionsNeedingValues.length) {
      await productService.upsertProductOptions(optionsNeedingValues);
      logger.info(
        `Base.com: added option values to ${optionsNeedingValues.length} products`
      );
    }

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
          product_variants: toUpdate.map(({ variant }) => ({
            id: mappedVariants.get(variant.base_variant_id)!.medusa_variant_id,
            ...toVariantUpdatePayload(variant),
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
              ...toVariantCreatePayload(variant, product.option_title),
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
