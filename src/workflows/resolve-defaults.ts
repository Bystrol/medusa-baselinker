import type { MedusaContainer } from "@medusajs/framework/types";

import { BASE_MODULE } from "../modules/base";
import type BaseModuleService from "../modules/base/service";

/**
 * Resolves the sales channel and shipping profile imported products belong to.
 *
 * Both are configurable, and both fall back to the first row when they are
 * not. The fallback warns, naming what it picked: on a store with a single
 * channel it is the obvious answer, and on a store with several it is a coin
 * flip that the operator should know about rather than discover through
 * products appearing in the wrong place.
 */
const resolveFirst = async (
  container: MedusaContainer,
  {
    configured,
    serviceKey,
    listMethod,
    label,
    optionName,
  }: {
    configured?: string;
    serviceKey: string;
    listMethod: string;
    label: string;
    optionName: string;
  }
): Promise<string | undefined> => {
  if (configured) return configured;

  const logger = container.resolve("logger");
  const service = container.resolve(serviceKey) as Record<string, Function>;
  const rows = (await service[listMethod]({})) as { id: string; name: string }[];

  if (rows.length > 1) {
    logger.warn(
      `Base.com: ${optionName} is not configured and the store has ${rows.length} ${label}s - ` +
        `falling back to "${rows[0]?.name}". Set ${optionName} to make this deterministic.`
    );
  }

  return rows[0]?.id;
};

export const resolveSalesChannelId = async (
  container: MedusaContainer
): Promise<string | undefined> => {
  const baseService: BaseModuleService = container.resolve(BASE_MODULE);

  return resolveFirst(container, {
    configured: baseService.options.sales_channel_id,
    serviceKey: "sales_channel",
    listMethod: "listSalesChannels",
    label: "sales channel",
    optionName: "sales_channel_id",
  });
};

export const resolveShippingProfileId = async (
  container: MedusaContainer
): Promise<string | undefined> => {
  const baseService: BaseModuleService = container.resolve(BASE_MODULE);

  return resolveFirst(container, {
    configured: baseService.options.shipping_profile_id,
    serviceKey: "fulfillment",
    listMethod: "listShippingProfiles",
    label: "shipping profile",
    optionName: "shipping_profile_id",
  });
};
