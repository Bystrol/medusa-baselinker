import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import type { MappedProduct } from "../../lib/product-mapper";

export interface SplitProductsInput {
  products: MappedProduct[];
}

export interface SplitProductsOutput {
  toCreate: MappedProduct[];
  toUpdate: { product: MappedProduct; medusaProductId: string }[];
}

/**
 * Sorts mapped products into those Medusa already holds and those it does not.
 *
 * Read-only, and separate from the write steps so that deciding what to do and
 * doing it stay independently reviewable.
 */
export const splitProductsByMappingStep = createStep(
  "split-products-by-mapping",
  async ({ products }: SplitProductsInput, { container }) => {
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    const mappings = await baseService.listBaseProductMappings({});
    const mapped = new Map(
      mappings.map((mapping) => [
        mapping.base_product_id,
        mapping.medusa_product_id,
      ])
    );

    const toCreate: MappedProduct[] = [];
    const toUpdate: SplitProductsOutput["toUpdate"] = [];

    for (const product of products) {
      const medusaProductId = mapped.get(product.base_product_id);

      if (medusaProductId) {
        toUpdate.push({ product, medusaProductId });
      } else {
        toCreate.push(product);
      }
    }

    return new StepResponse<SplitProductsOutput>({ toCreate, toUpdate });
  }
);
