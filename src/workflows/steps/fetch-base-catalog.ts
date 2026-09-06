import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import { mapBaseProducts, type MappedProduct } from "../../lib/product-mapper";

/** getInventoryProductsData accepts at most a thousand ids per call. */
const BATCH_SIZE = 1000;

export interface FetchBaseCatalogOutput {
  products: MappedProduct[];
  /** Every Base id the listing returned, for the missing-product plan. */
  seenBaseProductIds: string[];
}

/**
 * Reads the whole Base catalog and maps it into Medusa's shape.
 *
 * Read-only, so there is nothing to compensate. The batching matters: fanning
 * the whole catalog out through Promise.all blows through the
 * hundred-requests-per-minute limit on any real store and hammers the database
 * at the same time.
 */
export const fetchBaseCatalogStep = createStep(
  "fetch-base-catalog",
  async (_input: void, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);
    const productService = container.resolve("product");

    const priceGroups = (await baseService.getPriceGroups()).map((group) => ({
      id: String(group.price_group_id),
      currency: group.currency,
      is_default: group.is_default,
    }));

    const baseProductIds = await baseService.listProductIds();

    const raw: Record<string, any> = {};
    for (let index = 0; index < baseProductIds.length; index += BATCH_SIZE) {
      const batch = baseProductIds.slice(index, index + BATCH_SIZE);
      logger.info(
        `Base.com: fetching product data ${index + 1}-${
          index + batch.length
        } of ${baseProductIds.length}`
      );
      Object.assign(raw, await baseService.getProductsData(batch));
    }

    // Features - the only structured attributes Base holds - are absent from
    // the variants nested under a parent. A variant is a product in its own
    // right, so they are fetched again by their own ids; without this the
    // catalog can only ever have a single generated option.
    const variantIds = Object.values(raw).flatMap((product: any) =>
      Object.keys(product.variants ?? {})
    );

    const variantFeatures: Record<string, Record<string, unknown> | null> = {};
    for (let index = 0; index < variantIds.length; index += BATCH_SIZE) {
      const batch = variantIds.slice(index, index + BATCH_SIZE);
      const details = await baseService.getProductsData(batch);

      for (const [variantId, detail] of Object.entries(details)) {
        variantFeatures[variantId] =
          ((detail as any).text_fields?.features as Record<string, unknown>) ??
          null;
      }
    }

    // Handles have to avoid colliding with products Medusa already holds, but
    // not with the ones this sync is about to update - otherwise every run
    // would push a product's own handle one suffix further.
    const mappings = await baseService.listBaseProductMappings({});
    const ownHandles = new Set(mappings.map((mapping) => mapping.handle));
    const existing = await productService.listProducts({}, { select: ["handle"] });
    const takenHandles = new Set(
      existing
        .map((product: { handle: string }) => product.handle)
        .filter((handle: string) => !ownHandles.has(handle))
    );

    const products = mapBaseProducts(raw, {
      priceGroups,
      takenHandles,
      variantFeatures,
    });

    const withRealOptions = products.filter(
      (product) => product.options_from_features
    ).length;

    logger.info(
      `Base.com: mapped ${products.length} products with ${products.reduce(
        (sum, product) => sum + product.variants.length,
        0
      )} variants; ${withRealOptions} use options derived from Base features`
    );

    return new StepResponse<FetchBaseCatalogOutput>({
      products,
      seenBaseProductIds: baseProductIds,
    });
  }
);
