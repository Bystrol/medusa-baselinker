export { BASE_MODULE } from "./modules/base";
export type { BaseModuleOptions } from "./modules/base/service";

export * from "./lib/base-client";
export * from "./lib/base-types";
export * from "./lib/product-mapper";
export * from "./lib/variant-options";
export * from "./lib/stock-mapper";
export * from "./lib/missing-products";
export * from "./lib/medusa-payload";

export { syncBaseCatalogWorkflow } from "./workflows/sync-base-catalog";
