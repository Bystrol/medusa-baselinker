import { MedusaService } from "@medusajs/framework/utils";
import type { Logger } from "@medusajs/framework/types";

import { BaseClient } from "../../lib/base-client";
import type {
  BaseProduct,
  BaseProductListItem,
  BaseProductStock,
  BasePriceGroup,
  BaseWarehouse,
} from "../../lib/base-types";
import { BaseProductMapping } from "./models/base-product-mapping";
import { BaseVariantMapping } from "./models/base-variant-mapping";
import { BaseLocationMapping } from "./models/base-location-mapping";
import { BaseOrderMapping } from "./models/base-order-mapping";
import { BaseSyncState } from "./models/base-sync-state";

export interface BaseModuleOptions {
  /** API key from the Base.com panel: My account -> API. */
  api_key: string;
  /** Inventory to sync. Defaults to the account's default inventory. */
  inventory_id?: string;
  /** Status assigned to orders exported to Base. */
  order_status_id?: number;
  /** Order source shown in Base for orders coming from Medusa. */
  custom_source_id?: number;
  /**
   * Sales channel new products are linked to. Taking whichever channel comes
   * back first is a coin flip on a store with more than one.
   */
  sales_channel_id?: string;
  /** Shipping profile assigned to imported products, for the same reason. */
  shipping_profile_id?: string;
  /** Base allows 100 requests per minute; lower it to leave room for other clients. */
  requests_per_minute?: number;
  /**
   * What to do with a product Medusa has mapped that Base stopped returning.
   * Defaults to "draft", which removes it from sale while staying reversible.
   */
  missing_product_strategy?: "draft" | "delete" | "ignore";
  /**
   * Largest share of mapped products one sync may withdraw before it refuses
   * to act. Absence is inferred from a paginated listing, so a failed page
   * looks identical to a mass withdrawal. Defaults to 0.2.
   */
  max_missing_ratio?: number;
}

type InjectedDependencies = {
  logger: Logger;
};

/**
 * Module service for the Base.com integration.
 *
 * Deliberately thin: it owns the mapping tables and wraps the API, while the
 * business logic lives in workflows. The API surface here returns Base shapes
 * as recorded in fixtures - translating them into Medusa's shapes is the
 * mapping layer's job.
 */
class BaseModuleService extends MedusaService({
  BaseProductMapping,
  BaseVariantMapping,
  BaseLocationMapping,
  BaseOrderMapping,
  BaseSyncState,
}) {
  private readonly client_: BaseClient;
  private readonly options_: BaseModuleOptions;
  private readonly logger_: Logger;
  /** Resolved lazily: the default inventory is only known after an API call. */
  private inventoryId_?: string;

  constructor({ logger }: InjectedDependencies, options: BaseModuleOptions) {
    super(...arguments);

    this.logger_ = logger;
    this.options_ = options;
    this.inventoryId_ = options.inventory_id;
    this.client_ = new BaseClient({
      apiKey: options.api_key,
      requestsPerMinute: options.requests_per_minute,
      logger,
    });
  }

  get options(): BaseModuleOptions {
    return this.options_;
  }

  get client(): BaseClient {
    return this.client_;
  }

  /**
   * Resolves the inventory to work against, preferring the configured one and
   * falling back to the account's default.
   */
  async getInventoryId(): Promise<string> {
    if (this.inventoryId_) return this.inventoryId_;

    const response = await this.client_.call("getInventories");
    const inventories = Object.values(
      (response.inventories ?? {}) as Record<string, any>
    );

    const inventory =
      inventories.find((entry: any) => entry.is_default) ?? inventories[0];

    if (!inventory) {
      throw new Error(
        "Base.com: the account has no inventory to synchronize with"
      );
    }

    this.inventoryId_ = String(inventory.inventory_id);
    this.logger_.info(
      `Base.com: using inventory ${inventory.name} (${this.inventoryId_})`
    );

    return this.inventoryId_;
  }

  async getPriceGroups(): Promise<BasePriceGroup[]> {
    const response = await this.client_.call("getInventoryPriceGroups");
    return (response.price_groups ?? []) as BasePriceGroup[];
  }

  async getWarehouses(): Promise<BaseWarehouse[]> {
    const response = await this.client_.call("getInventoryWarehouses");
    // Recorded as an array, but object-keyed collections are common enough in
    // this API to be worth tolerating.
    const warehouses = response.warehouses ?? [];
    return (
      Array.isArray(warehouses) ? warehouses : Object.values(warehouses)
    ) as BaseWarehouse[];
  }

  /**
   * Lists product ids page by page. The list contains parent products only -
   * variants come nested inside getInventoryProductsData.
   */
  async listProductIds(): Promise<string[]> {
    const inventoryId = await this.getInventoryId();
    const ids: string[] = [];

    for (let page = 1; ; page++) {
      const response = await this.client_.call("getInventoryProductsList", {
        inventory_id: inventoryId,
        page,
      });

      const products = (response.products ?? {}) as Record<
        string,
        BaseProductListItem
      >;
      const pageIds = Object.keys(products);
      ids.push(...pageIds);

      // Base caps a page at 1000; a short page means this was the last one.
      if (pageIds.length < 1000) break;
    }

    this.logger_.info(`Base.com: found ${ids.length} products`);
    return ids;
  }

  /** Fetches full product data, including nested variants, for up to 1000 ids. */
  async getProductsData(
    productIds: string[]
  ): Promise<Record<string, BaseProduct>> {
    if (!productIds.length) return {};

    const inventoryId = await this.getInventoryId();
    const response = await this.client_.call("getInventoryProductsData", {
      inventory_id: inventoryId,
      products: productIds.map((id) => Number(id)),
    });

    return (response.products ?? {}) as Record<string, BaseProduct>;
  }

  /**
   * Stock for the whole inventory in one call, variants included. Far cheaper
   * than getProductsData, which is why the frequent stock-only sync uses it.
   */
  async getProductsStock(): Promise<Record<string, BaseProductStock>> {
    const inventoryId = await this.getInventoryId();
    const response = await this.client_.call("getInventoryProductsStock", {
      inventory_id: inventoryId,
    });

    return (response.products ?? {}) as Record<string, BaseProductStock>;
  }

  async addOrder(payload: Record<string, unknown>): Promise<string> {
    const response = await this.client_.call("addOrder", {
      order_status_id: this.options_.order_status_id,
      custom_source_id: this.options_.custom_source_id,
      ...payload,
    });

    return String(response.order_id ?? "");
  }

  /**
   * Orders confirmed at or after the given timestamp. One call returns status,
   * `date_in_status` and the tracking number, which is why the status sync
   * polls this instead of the event journal - the journal is always empty.
   */
  async getOrdersSince(timestamp: number): Promise<Record<string, unknown>[]> {
    const response = await this.client_.call("getOrders", {
      date_confirmed_from: timestamp,
      get_unconfirmed_orders: true,
    });

    return (response.orders ?? []) as Record<string, unknown>[];
  }

  async getOrderPackages(orderId: string): Promise<Record<string, unknown>[]> {
    const response = await this.client_.call("getOrderPackages", {
      order_id: orderId,
    });

    return (response.packages ?? []) as Record<string, unknown>[];
  }

  /** Reads a sync cursor, e.g. the timestamp orders were last polled from. */
  async getSyncState(key: string): Promise<string | undefined> {
    const [state] = await this.listBaseSyncStates({ key });
    return state?.value ?? undefined;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    const [state] = await this.listBaseSyncStates({ key });

    if (state) {
      await this.updateBaseSyncStates({ id: state.id, value });
      return;
    }

    await this.createBaseSyncStates([{ key, value }]);
  }
}

export default BaseModuleService;
