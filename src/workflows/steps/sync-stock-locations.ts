import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createStockLocationsWorkflow,
  deleteStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows";

import { BASE_MODULE } from "../../modules/base";
import type BaseModuleService from "../../modules/base/service";
import { warehouseKey } from "../../lib/base-types";

export interface SyncStockLocationsOutput {
  /** Base warehouse key ("bl_153201") to Medusa stock location id. */
  locationByWarehouse: Record<string, string>;
}

interface CompensationData {
  createdLocationIds: string[];
  createdMappingIds: string[];
}

/**
 * Ensures every Base warehouse has a matching Medusa stock location.
 *
 * Existing locations are left alone: a store may already have locations set up
 * for other purposes, and renaming or reshaping them is not this plugin's
 * business. Only the mapping is created.
 */
export const syncStockLocationsStep = createStep(
  "sync-stock-locations",
  async (_input: void, { container }) => {
    const logger = container.resolve("logger");
    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    const warehouses = await baseService.getWarehouses();
    const mappings = await baseService.listBaseLocationMappings({});
    const mapped = new Map(
      mappings.map((mapping) => [
        mapping.base_warehouse_id,
        mapping.medusa_location_id,
      ])
    );

    const locationByWarehouse: Record<string, string> = {};
    const createdLocationIds: string[] = [];
    const createdMappingIds: string[] = [];

    for (const warehouse of warehouses) {
      const key = warehouseKey(warehouse);
      const existing = mapped.get(key);

      if (existing) {
        locationByWarehouse[key] = existing;
        continue;
      }

      const { result } = await createStockLocationsWorkflow(container).run({
        input: {
          locations: [
            {
              name: warehouse.name,
              address: warehouse.address
                ? {
                    address_1: warehouse.address,
                    city: warehouse.city,
                    postal_code: warehouse.postcode,
                    country_code: warehouse.country,
                  }
                : undefined,
            },
          ],
        },
      });

      const location = result[0];
      const [mapping] = await baseService.createBaseLocationMappings([
        {
          base_warehouse_id: key,
          medusa_location_id: location.id,
          name: warehouse.name,
        },
      ]);

      locationByWarehouse[key] = location.id;
      createdLocationIds.push(location.id);
      createdMappingIds.push(mapping.id);

      logger.info(
        `Base.com: created stock location "${warehouse.name}" for warehouse ${key}`
      );
    }

    return new StepResponse<SyncStockLocationsOutput, CompensationData>(
      { locationByWarehouse },
      { createdLocationIds, createdMappingIds }
    );
  },
  async (data, { container }) => {
    if (!data) return;

    const baseService: BaseModuleService = container.resolve(BASE_MODULE);

    if (data.createdMappingIds.length) {
      await baseService.deleteBaseLocationMappings(data.createdMappingIds);
    }

    // Only locations this step created are removed; pre-existing ones were
    // never touched and must survive a rollback.
    if (data.createdLocationIds.length) {
      await deleteStockLocationsWorkflow(container).run({
        input: { ids: data.createdLocationIds },
      });
    }
  }
);
