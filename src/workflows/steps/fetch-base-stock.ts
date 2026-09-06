import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import { mapStockResponse, type VariantStock } from "../../lib/stock-mapper";

/**
 * Reads stock for the whole inventory in a single call.
 *
 * getInventoryProductsStock returns every product and every variant at once,
 * which is what makes a frequent stock-only sync affordable: the full catalog
 * sync needs one request per thousand products plus another per thousand
 * variants, this needs one in total.
 */
export const fetchBaseStockStep = createStep(
  "fetch-base-stock",
  async (_input: void, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    const response = await baseService.getProductsStock();
    const stockByVariant = mapStockResponse(response);

    logger.info(
      `Base.com: read stock for ${Object.keys(stockByVariant).length} variants`
    );

    return new StepResponse<{ stockByVariant: VariantStock }>({
      stockByVariant,
    });
  }
);
