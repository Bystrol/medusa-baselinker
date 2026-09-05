import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  deleteProductsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import {
  planMissingProducts,
  type MissingProductStrategy,
} from "../../lib/missing-products";

export interface ApplyMissingProductsInput {
  seenBaseProductIds: string[];
}

/**
 * Handles products Medusa has a mapping for that Base stopped returning.
 *
 * The default is to unpublish rather than delete. A draft product is gone from
 * the storefront for every practical purpose - the Store API filters on
 * published status and the cart refuses variants of unpublished products - but
 * it keeps its handle, its history and its mapping, so a false alarm costs one
 * sync instead of a full reimport.
 *
 * The guard in planMissingProducts matters more than the action: absence is
 * inferred from a paginated listing, so a timed-out page looks exactly like a
 * mass withdrawal.
 */
export const applyMissingProductsStep = createStep(
  "apply-missing-products",
  async ({ seenBaseProductIds }: ApplyMissingProductsInput, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    const strategy: MissingProductStrategy =
      (baseService.options.missing_product_strategy as MissingProductStrategy) ??
      "draft";
    const maxMissingRatio = baseService.options.max_missing_ratio ?? 0.2;

    const mappings = await baseService.listBaseProductMappings({});

    const plan = planMissingProducts({
      knownBaseProductIds: mappings.map((mapping) => mapping.base_product_id),
      seenBaseProductIds,
      strategy,
      maxMissingRatio,
    });

    if (plan.aborted) {
      // Loud, but not fatal: the catalog import that ran before this step is
      // sound, and failing the whole workflow would discard it.
      logger.error(`Base.com: ${plan.reason}`);
      return new StepResponse({ affected: 0, aborted: true });
    }

    if (!plan.missing.length) {
      return new StepResponse({ affected: 0, aborted: false });
    }

    const missingMappings = mappings.filter((mapping) =>
      plan.missing.includes(mapping.base_product_id)
    );
    const productIds = missingMappings.map(
      (mapping) => mapping.medusa_product_id
    );

    if (strategy === "delete") {
      await deleteProductsWorkflow(container).run({
        input: { ids: productIds },
      });
      await baseService.deleteBaseProductMappings(
        missingMappings.map((mapping) => mapping.id)
      );
      await baseService.deleteBaseVariantMappings({
        base_product_id: plan.missing,
      });
    } else {
      await updateProductsWorkflow(container).run({
        input: {
          products: productIds.map((id) => ({ id, status: "draft" as const })),
        },
      });
    }

    logger.warn(
      `Base.com: ${plan.missing.length} products are no longer in Base - applied "${strategy}"`
    );

    return new StepResponse({ affected: plan.missing.length, aborted: false });
  }
);
