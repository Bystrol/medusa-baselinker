/**
 * Base.com API recon - dumps real API responses into fixtures.
 *
 * Rationale: access to Base is limited by the trial, but work on mappings and
 * workflows is not. This script freezes the shape of the data so the rest of
 * the plugin can be built and tested offline once the trial expires.
 *
 * Run with:  BASE_API_KEY=xxx npm run recon
 *
 * Writes:
 *   fixtures/raw/<method>.json  - full payloads (gitignored, contain PII)
 *   fixtures/<method>.json      - anonymized payloads (safe to commit)
 *   fixtures/REPORT.md          - summary of shapes and values
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BaseClient, BaseApiError } from "../src/lib/base-client";

const ROOT = join(__dirname, "..");
const FIXTURES = join(ROOT, "fixtures");
const RAW = join(FIXTURES, "raw");

// ----------------------------------------------------------------- env

const loadEnv = () => {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!process.env[match[1]] && value) process.env[match[1]] = value;
  }
};

// ------------------------------------------------------------ anonymization

/** Fields holding personal data - cleared before fixtures are committed. */
const PII_KEYS = new Set([
  "email",
  "phone",
  "user_login",
  "user_comments",
  "admin_comments",
  "delivery_fullname",
  "delivery_company",
  "delivery_address",
  "delivery_postcode",
  "delivery_city",
  "delivery_state",
  "delivery_point_name",
  "delivery_point_address",
  "delivery_point_postcode",
  "delivery_point_city",
  "invoice_fullname",
  "invoice_company",
  "invoice_nip",
  "invoice_address",
  "invoice_postcode",
  "invoice_city",
  "invoice_state",
]);

/**
 * Replaces PII values with a placeholder while preserving type and shape
 * (an empty string stays empty) - mappings must keep facing the same edge
 * cases they will face in production.
 */
const anonymize = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) return value.map((v) => anonymize(v));

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        anonymize(v, k),
      ])
    );
  }

  if (key && PII_KEYS.has(key) && typeof value === "string" && value !== "") {
    return `redacted-${key}`;
  }

  return value;
};

// ------------------------------------------------------------------ writing

const captured: { method: string; label: string; data: any }[] = [];

const save = (label: string, method: string, data: unknown) => {
  writeFileSync(
    join(RAW, `${label}.json`),
    JSON.stringify(data, null, 2),
    "utf8"
  );
  writeFileSync(
    join(FIXTURES, `${label}.json`),
    JSON.stringify(anonymize(data), null, 2),
    "utf8"
  );
  captured.push({ method, label, data });
};

// --------------------------------------------------------------------- main

const main = async () => {
  loadEnv();

  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) {
    console.error(
      "BASE_API_KEY is missing. Copy .env.example to .env and paste the key from the Base.com panel (My account -> API)."
    );
    process.exit(1);
  }

  mkdirSync(RAW, { recursive: true });

  const client = new BaseClient({
    apiKey,
    logger: {
      debug: () => {},
      info: (m) => console.log(`  ${m}`),
      warn: (m) => console.warn(`  ! ${m}`),
      error: (m) => console.error(`  x ${m}`),
    },
  });

  /** Calls a method and stores the result; a failure does not abort the recon. */
  const probe = async (
    label: string,
    method: string,
    parameters: Record<string, unknown> = {}
  ): Promise<any | undefined> => {
    process.stdout.write(`-> ${label} ... `);
    try {
      const data = await client.call(method, parameters);
      save(label, method, data);
      console.log("ok");
      return data;
    } catch (error) {
      const message =
        error instanceof BaseApiError
          ? `${error.message}${error.code ? "" : " (no error code)"}`
          : (error as Error).message;
      console.log(`FAILED: ${message}`);
      writeFileSync(
        join(FIXTURES, `${label}.error.json`),
        JSON.stringify({ method, parameters, error: message }, null, 2),
        "utf8"
      );
      return undefined;
    }
  };

  console.log("\n=== Catalog ===");
  const inventories = await probe("getInventories", "getInventories");
  await probe("getInventoryWarehouses", "getInventoryWarehouses");
  await probe("getInventoryPriceGroups", "getInventoryPriceGroups");

  const inventoryList: any[] = Object.values(inventories?.inventories ?? {});
  const inventoryId =
    process.env.BASE_INVENTORY_ID ||
    String(
      inventoryList.find((i: any) => i.is_default)?.inventory_id ??
        inventoryList[0]?.inventory_id ??
        ""
    );

  if (!inventoryId) {
    console.error(
      "\nCould not determine inventory_id - skipping the rest of the catalog recon."
    );
  } else {
    console.log(`   (inventory_id = ${inventoryId})`);
    const params = { inventory_id: inventoryId };

    await probe("getInventoryCategories", "getInventoryCategories", params);
    await probe("getInventoryManufacturers", "getInventoryManufacturers", params);
    await probe("getInventoryExtraFields", "getInventoryExtraFields");
    await probe("getInventoryProductsStock", "getInventoryProductsStock", params);
    await probe("getInventoryProductsPrices", "getInventoryProductsPrices", params);

    const list = await probe("getInventoryProductsList", "getInventoryProductsList", {
      ...params,
      page: 1,
    });

    // Full data is fetched for a sample only - we are after the shape, not volume.
    const productIds = Object.keys(list?.products ?? {}).slice(0, 20);
    let productsData: any | undefined;
    if (productIds.length) {
      productsData = await probe(
        "getInventoryProductsData",
        "getInventoryProductsData",
        { ...params, products: productIds.map((id) => Number(id)) }
      );
    }

    // Variants are products in their own right, and their `features` - the
    // only structured attributes Base holds - are visible only when fetched
    // that way. Nested under the parent they are absent entirely.
    const variantIds = Object.values(
      (productsData?.products ?? {}) as Record<string, any>
    ).flatMap((product) => Object.keys(product.variants ?? {}));

    if (variantIds.length) {
      await probe(
        "getInventoryProductsData_variants",
        "getInventoryProductsData",
        { ...params, products: variantIds.map((id) => Number(id)) }
      );
    }
  }

  console.log("\n=== Orders ===");
  await probe("getOrderStatusList", "getOrderStatusList");
  await probe("getOrderSources", "getOrderSources");
  await probe("getOrderExtraFields", "getOrderExtraFields");
  await probe("getCouriersList", "getCouriersList");

  // Event journal - a candidate mechanism for incremental order status sync.
  // The API rejects last_log_id: 0, so the very first read has to start at 1.
  await probe("getJournalList", "getJournalList", { last_log_id: 1 });

  // The plain call came back empty even after an order existed, so probe once
  // more with an explicit type filter to tell "journal is empty" apart from
  // "journal needs to be asked differently".
  await probe("getJournalList_filtered", "getJournalList", {
    last_log_id: 1,
    logs_types: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  });

  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;
  const orders = await probe("getOrders", "getOrders", {
    date_confirmed_from: since,
    get_unconfirmed_orders: true,
  });

  const firstOrderId = (orders?.orders as any[])?.[0]?.order_id;
  if (firstOrderId) {
    await probe("getOrderPackages", "getOrderPackages", {
      order_id: firstOrderId,
    });
  } else {
    console.log("   (no orders in Base - skipping getOrderPackages)");
  }

  writeReport();

  console.log(`\nDone. Captured ${captured.length} responses.`);
  console.log(`  fixtures/           - anonymized, safe to commit`);
  console.log(`  fixtures/raw/       - full payloads, gitignored`);
  console.log(`  fixtures/REPORT.md  - summary to review`);
};

// ------------------------------------------------------------------- report

/** Condensed description of a value - keeps the report readable. */
const describe = (value: unknown, depth = 0): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length
      ? `array[${value.length}] of ${describe(value[0], depth + 1)}`
      : "array[0]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (depth >= 1) return `object{${keys.slice(0, 8).join(", ")}}`;
    return `object{\n${keys
      .slice(0, 40)
      .map(
        (k) =>
          `      ${k}: ${describe((value as any)[k], depth + 1)}`
      )
      .join("\n")}\n    }`;
  }
  return `${typeof value} (${JSON.stringify(value)})`;
};

const writeReport = () => {
  const lines: string[] = [
    "# Base.com API recon",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Response shapes captured from a live account. They serve as the source of",
    "truth for mappings and for offline tests once the trial expires.",
    "",
  ];

  // Questions the recon is meant to answer outright.
  lines.push("## Key findings", "");

  const prices = captured.find((c) => c.label === "getInventoryProductsPrices");
  if (prices) {
    const sample = Object.values(prices.data.products ?? {})[0];
    lines.push(
      "### Price format (do we need to divide by 100?)",
      "",
      "Medusa v2 stores prices as-is (49.99 is 49.99, not 4999).",
      "The sample below settles whether Base returns the same:",
      "",
      "```json",
      JSON.stringify(sample, null, 2).slice(0, 1500),
      "```",
      ""
    );
  }

  const productsData = captured.find(
    (c) => c.label === "getInventoryProductsData"
  );
  if (productsData) {
    const products = Object.values(productsData.data.products ?? {}) as any[];
    const withVariants = products.filter(
      (p) => Object.keys(p.variants ?? {}).length > 0
    ).length;
    lines.push(
      "### Variants",
      "",
      `Products in sample: ${products.length}`,
      `- with variants: ${withVariants}`,
      `- without variants: ${products.length - withVariants}`,
      "",
      "Products without variants must receive a single default variant in Medusa,",
      "built from the product's own data (sku/ean/prices), rather than being skipped.",
      ""
    );
  }

  const statuses = captured.find((c) => c.label === "getOrderStatusList");
  if (statuses) {
    const list = (statuses.data.statuses as any[]) ?? [];
    lines.push(
      "### Base order statuses (to map onto Medusa states)",
      "",
      ...list.map((s: any) => `- \`${s.id}\` - ${s.name}`),
      ""
    );
  }

  const couriers = captured.find((c) => c.label === "getCouriersList");
  if (couriers) {
    const list = (couriers.data.couriers as any[]) ?? [];
    lines.push(
      "### Couriers (for tracking and a later fulfillment provider)",
      "",
      ...list.slice(0, 40).map((c: any) => `- \`${c.code}\` - ${c.name}`),
      ""
    );
  }

  lines.push("## Response shapes", "");
  for (const { label, method, data } of captured) {
    lines.push(`### ${label}`, "", `Method: \`${method}\``, "", "```");
    for (const [key, value] of Object.entries(data)) {
      if (key === "status") continue;
      lines.push(`  ${key}: ${describe(value)}`);
    }
    lines.push("```", "");
  }

  writeFileSync(join(FIXTURES, "REPORT.md"), lines.join("\n"), "utf8");
};

main().catch((error) => {
  console.error("\nRecon aborted:", error);
  process.exit(1);
});
