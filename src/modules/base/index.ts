import { Module } from "@medusajs/framework/utils";
import BaseModuleService from "./service";

/** Module names must be camelCase - dashes break container resolution. */
export const BASE_MODULE = "base";

export default Module(BASE_MODULE, {
  service: BaseModuleService,
});
