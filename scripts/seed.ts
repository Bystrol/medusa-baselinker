/**
 * Seeds a Base.com account with test products.
 *
 * The catalog below is not arbitrary: every entry targets a specific edge case
 * that the mapping layer has to survive, including the ones the u11d plugin
 * gets wrong. Seeding by hand would almost certainly miss them.
 *
 * Usage:
 *   npm run seed -- --plan      show what would be created, call nothing (default)
 *   npm run seed -- --setup     add a second warehouse and price group, if missing
 *   npm run seed -- --apply     actually create the products in Base.com
 *   npm run seed -- --order     create one test order with a manual parcel
 *   npm run seed -- --cleanup   delete only the products this script created
 *
 * Created product ids are recorded in fixtures/raw/seed-state.json (gitignored),
 * so cleanup can never touch products that were already on the account.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BaseClient, BaseApiError } from "../src/lib/base-client";

const ROOT = join(__dirname, "..");
const STATE_FILE = join(ROOT, "fixtures", "raw", "seed-state.json");

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

// -------------------------------------------------------------- catalog

/** Placeholder image host - Base fetches these by URL when the product is created. */
const img = (seed: string, size = 600) =>
  `https://picsum.photos/seed/${seed}/${size}/${size}`;

interface SeedContext {
  /** All price group ids on the account, default one first. */
  priceGroupIds: number[];
  /** All warehouse ids on the account, default one first. */
  warehouseIds: string[];
}

interface SeedProduct {
  /** Stable key used for logging and for the state file. */
  key: string;
  /** Which edge case this product exists to exercise. */
  covers: string;
  build: (ctx: SeedContext) => Record<string, unknown>;
  /**
   * Variants in Base are not a nested structure - they are separate products
   * pointing at the parent through `parent_id`. Passing a `variants` object to
   * addInventoryProduct is accepted and then silently ignored, which is how the
   * first seed run ended up with nine variant-less products.
   */
  children?: (ctx: SeedContext) => { key: string; payload: Record<string, unknown> }[];
}

/** Spreads a single price across every price group on the account. */
const allPrices = (ctx: SeedContext, price: number) =>
  Object.fromEntries(ctx.priceGroupIds.map((id) => [id, price]));

/** Puts stock in the default warehouse only. */
const defaultStock = (ctx: SeedContext, qty: number) => ({
  [ctx.warehouseIds[0]]: qty,
});

const SEED_PRODUCTS: SeedProduct[] = [
  {
    key: "simple-no-variants",
    covers:
      "Product with no variants at all - u11d issue #2, where it silently ends up with zero variants in Medusa",
    build: (ctx) => ({
      sku: "SEED-SIMPLE-001",
      ean: "5901234123457",
      tax_rate: 23,
      weight: 0.5,
      height: 10,
      width: 20,
      length: 30,
      text_fields: {
        name: "Seed Simple Product",
        description: "A plain product with no variants.",
      },
      images: { 0: `url:${img("simple")}` },
      prices: allPrices(ctx, 49.99),
      stock: defaultStock(ctx, 25),
    }),
  },
  {
    key: "two-variants",
    covers:
      "Product with real variants, each carrying its own sku, ean, price and stock",
    build: (ctx) => ({
      sku: "SEED-VARIANT-001",
      ean: "5901234123464",
      tax_rate: 23,
      weight: 0.4,
      text_fields: {
        name: "Seed Variant Product",
        description: "A product split into two variants.",
      },
      images: { 0: `url:${img("variant")}` },
      prices: allPrices(ctx, 79.0),
      stock: defaultStock(ctx, 0),
    }),
    children: (ctx) => [
      {
        key: "two-variants/size-s",
        payload: {
          sku: "SEED-VARIANT-001-S",
          ean: "5901234123471",
          tax_rate: 23,
          text_fields: { name: "Seed Variant Product - Size S" },
          prices: allPrices(ctx, 79.0),
          stock: defaultStock(ctx, 10),
        },
      },
      {
        key: "two-variants/size-l",
        payload: {
          sku: "SEED-VARIANT-001-L",
          ean: "5901234123488",
          tax_rate: 23,
          text_fields: { name: "Seed Variant Product - Size L" },
          // Deliberately a different price than the parent - catches mappings
          // that read the price off the parent instead of the variant.
          prices: allPrices(ctx, 89.0),
          stock: defaultStock(ctx, 3),
        },
      },
    ],
  },
  {
    key: "decimal-price",
    covers:
      "Awkward decimal price - settles whether Base returns 12.34 or 1234, which decides if a conversion to Medusa is needed",
    build: (ctx) => ({
      sku: "SEED-PRICE-001",
      tax_rate: 23,
      text_fields: {
        name: "Seed Decimal Price Product",
        description: "Priced at 12.34 to expose the unit format.",
      },
      prices: allPrices(ctx, 12.34),
      stock: defaultStock(ctx, 5),
    }),
  },
  {
    key: "minimal-fields",
    covers:
      "Almost everything missing - no ean, no description, no images, zero price and zero stock",
    build: (ctx) => ({
      sku: "SEED-MINIMAL-001",
      tax_rate: 0,
      text_fields: {
        name: "Seed Minimal Product",
      },
      prices: allPrices(ctx, 0),
      stock: defaultStock(ctx, 0),
    }),
  },
  {
    key: "duplicate-title-a",
    covers:
      "Two products sharing one name - the handle is derived from the title, so without deduplication the second insert hits a unique constraint",
    build: (ctx) => ({
      sku: "SEED-DUP-001",
      tax_rate: 23,
      text_fields: {
        name: "Seed Duplicate Name",
        description: "First of two products with an identical name.",
      },
      prices: allPrices(ctx, 19.99),
      stock: defaultStock(ctx, 7),
    }),
  },
  {
    key: "duplicate-title-b",
    covers: "The colliding twin of the entry above",
    build: (ctx) => ({
      sku: "SEED-DUP-002",
      tax_rate: 23,
      text_fields: {
        name: "Seed Duplicate Name",
        description: "Second of two products with an identical name.",
      },
      prices: allPrices(ctx, 24.99),
      stock: defaultStock(ctx, 4),
    }),
  },
  {
    key: "special-chars",
    covers:
      "Diacritics, quotes and slashes in the title - exercises slug generation",
    build: (ctx) => ({
      sku: "SEED-SPECIAL-001",
      tax_rate: 23,
      text_fields: {
        name: 'Zestaw "Premium" – żółć & ćma / 100% bawełna',
        description: "Non-ASCII characters, quotes and a slash in the name.",
      },
      prices: allPrices(ctx, 149.5),
      stock: defaultStock(ctx, 2),
    }),
  },
];

/** Only meaningful when the account actually has more than one warehouse. */
const multiWarehouseProduct: SeedProduct = {
  key: "multi-warehouse",
  covers:
    "Stock split across two warehouses - exercises the warehouse to stock-location mapping",
  build: (ctx) => ({
    sku: "SEED-WAREHOUSE-001",
    tax_rate: 23,
    text_fields: {
      name: "Seed Multi Warehouse Product",
      description: "Stock lives in two warehouses at once.",
    },
    prices: allPrices(ctx, 59.0),
    stock: {
      [ctx.warehouseIds[0]]: 12,
      [ctx.warehouseIds[1]]: 8,
    },
  }),
};

/** Only meaningful when the account actually has more than one price group. */
const multiPriceGroupProduct: SeedProduct = {
  key: "multi-price-group",
  covers:
    "A different price per price group - exercises currency and price-list mapping",
  build: (ctx) => ({
    sku: "SEED-PRICEGROUP-001",
    tax_rate: 23,
    text_fields: {
      name: "Seed Multi Price Group Product",
      description: "Each price group carries a different price.",
    },
    prices: Object.fromEntries(
      ctx.priceGroupIds.map((id, index) => [id, 100 + index * 10])
    ),
    stock: defaultStock(ctx, 6),
  }),
};

// ---------------------------------------------------------------- state

interface SeedState {
  inventory_id: string;
  created: { key: string; product_id: string; sku: string }[];
  /** Orders cannot be deleted through the API, so these are recorded for reference only. */
  orders?: { order_id: string; package_number?: string }[];
}

const readState = (): SeedState | undefined =>
  existsSync(STATE_FILE)
    ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as SeedState)
    : undefined;

const writeState = (state: SeedState) => {
  mkdirSync(join(ROOT, "fixtures", "raw"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
};

// ----------------------------------------------------------------- main

const main = async () => {
  loadEnv();

  const args = process.argv.slice(2);
  const mode = args.includes("--cleanup")
    ? "cleanup"
    : args.includes("--setup")
      ? "setup"
      : args.includes("--order")
        ? "order"
        : args.includes("--apply")
          ? "apply"
          : "plan";

  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) {
    console.error(
      "BASE_API_KEY is missing. Copy .env.example to .env and paste the key from the Base.com panel (My account -> API)."
    );
    process.exit(1);
  }

  const client = new BaseClient({
    apiKey,
    logger: {
      debug: () => {},
      info: (m) => console.log(`  ${m}`),
      warn: (m) => console.warn(`  ! ${m}`),
      error: (m) => console.error(`  x ${m}`),
    },
  });

  if (mode === "cleanup") {
    await cleanup(client);
    return;
  }

  if (mode === "setup") {
    await setupInventory(client);
    return;
  }

  if (mode === "order") {
    await seedOrder(client);
    return;
  }

  // Resolve the account layout first - ids differ per account, so nothing
  // about warehouses or price groups can be hardcoded.
  const inventories = await client.call("getInventories");
  const inventoryList: any[] = Object.values(inventories.inventories ?? {});
  const inventoryId =
    process.env.BASE_INVENTORY_ID ||
    String(
      inventoryList.find((i: any) => i.is_default)?.inventory_id ??
        inventoryList[0]?.inventory_id ??
        ""
    );

  if (!inventoryId) {
    console.error("No inventory found on the account - nothing to seed into.");
    process.exit(1);
  }

  const inventory = inventoryList.find(
    (i: any) => String(i.inventory_id) === String(inventoryId)
  );

  const warehouses = await client.call("getInventoryWarehouses");
  const priceGroups = await client.call("getInventoryPriceGroups");

  // The inventory declares which warehouses and price groups it accepts;
  // writing to any others is rejected by the API.
  const warehouseIds: string[] = (inventory?.warehouses ?? []).map(String);
  const priceGroupIds: number[] = (inventory?.price_groups ?? []).map(Number);

  if (!warehouseIds.length || !priceGroupIds.length) {
    console.error(
      "The inventory reports no warehouses or no price groups - configure them in the Base.com panel first."
    );
    console.error(
      `  warehouses on account: ${Object.keys(warehouses.warehouses ?? {}).length}, price groups: ${
        (priceGroups.price_groups as any[])?.length ?? 0
      }`
    );
    process.exit(1);
  }

  // Move the inventory defaults to the front so `defaultStock`/`allPrices` use them.
  const ctx: SeedContext = {
    warehouseIds: [
      ...warehouseIds.filter((w) => w === String(inventory?.default_warehouse)),
      ...warehouseIds.filter((w) => w !== String(inventory?.default_warehouse)),
    ],
    priceGroupIds: [
      ...priceGroupIds.filter((p) => p === Number(inventory?.default_price_group)),
      ...priceGroupIds.filter((p) => p !== Number(inventory?.default_price_group)),
    ],
  };

  const products = [...SEED_PRODUCTS];
  if (ctx.warehouseIds.length > 1) products.push(multiWarehouseProduct);
  if (ctx.priceGroupIds.length > 1) products.push(multiPriceGroupProduct);

  console.log(`\nInventory:    ${inventory?.name} (id ${inventoryId})`);
  console.log(`Warehouses:   ${ctx.warehouseIds.join(", ")}`);
  console.log(`Price groups: ${ctx.priceGroupIds.join(", ")}`);
  console.log(`\n${products.length} products to seed:\n`);

  for (const product of products) {
    console.log(`  ${product.key}`);
    console.log(`    ${product.covers}`);
  }

  if (ctx.warehouseIds.length === 1) {
    console.log(
      "\n  Note: the inventory has a single warehouse, so the multi-warehouse case is skipped."
    );
    console.log(
      "  Add a second warehouse in Base.com to cover stock-location mapping."
    );
  }
  if (ctx.priceGroupIds.length === 1) {
    console.log(
      "\n  Note: the inventory has a single price group, so the multi-price-group case is skipped."
    );
  }

  if (mode === "plan") {
    console.log(
      "\nThis was a dry run - nothing was written to Base.com."
    );
    console.log("Re-run with --apply to create these products.");
    return;
  }

  console.log("\nCreating products in Base.com ...\n");

  // Previous runs must not be silently forgotten: overwriting the state would
  // orphan whatever they created, leaving products on the account that cleanup
  // can no longer find.
  const previous = readState();
  if (previous?.created?.length) {
    console.error(
      `\n${previous.created.length} products from an earlier run are still recorded in the state file.`
    );
    console.error(
      "Run `npm run seed -- --cleanup` first, or they will be left on the account with no way to remove them automatically."
    );
    process.exit(1);
  }

  const state: SeedState = {
    inventory_id: inventoryId,
    created: [],
    orders: previous?.orders,
  };

  for (const product of products) {
    const payload = product.build(ctx);
    process.stdout.write(`-> ${product.key} ... `);

    try {
      const response = await client.call("addInventoryProduct", {
        inventory_id: inventoryId,
        ...payload,
      });

      const productId = String(
        (response as any).product_id ?? (response as any).storage_id ?? ""
      );
      state.created.push({
        key: product.key,
        product_id: productId,
        sku: String(payload.sku),
      });
      // Persist after every success so a mid-run failure still leaves a
      // cleanup trail for whatever was already created.
      writeState(state);
      console.log(`ok (product_id ${productId})`);

      // Children are created afterwards because they need the parent's id.
      for (const child of product.children?.(ctx) ?? []) {
        process.stdout.write(`   -> ${child.key} ... `);
        try {
          const childResponse = await client.call("addInventoryProduct", {
            inventory_id: inventoryId,
            parent_id: productId,
            ...child.payload,
          });

          const childId = String((childResponse as any).product_id ?? "");
          state.created.push({
            key: child.key,
            product_id: childId,
            sku: String(child.payload.sku),
          });
          writeState(state);
          console.log(`ok (product_id ${childId})`);
        } catch (error) {
          const message =
            error instanceof BaseApiError
              ? error.message
              : (error as Error).message;
          console.log(`FAILED: ${message}`);
        }
      }
    } catch (error) {
      const message =
        error instanceof BaseApiError ? error.message : (error as Error).message;
      console.log(`FAILED: ${message}`);
    }
  }

  console.log(`\nCreated ${state.created.length} products (${products.length} top-level plus variants).`);
  console.log(`State written to fixtures/raw/seed-state.json`);
  console.log(`\nNext: npm run recon`);
  console.log(`To remove them afterwards: npm run seed -- --cleanup`);
};

// ---------------------------------------------------------------- setup

/**
 * Ensures the inventory has at least two warehouses and two price groups,
 * so the seeded catalog can cover multi-warehouse and multi-price-group cases.
 *
 * Creating them is only half the job: an inventory carries its own list of the
 * warehouses and price groups it accepts, and writes to anything outside that
 * list are rejected. So the new ids have to be attached to the inventory too.
 */
const setupInventory = async (client: BaseClient) => {
  const inventories = await client.call("getInventories");
  const inventoryList: any[] = Object.values(inventories.inventories ?? {});
  const inventoryId =
    process.env.BASE_INVENTORY_ID ||
    String(
      inventoryList.find((i: any) => i.is_default)?.inventory_id ??
        inventoryList[0]?.inventory_id ??
        ""
    );

  const inventory = inventoryList.find(
    (i: any) => String(i.inventory_id) === String(inventoryId)
  );

  if (!inventory) {
    console.error("No inventory found on the account - create one in the Base.com panel first.");
    process.exit(1);
  }

  const warehouses: string[] = (inventory.warehouses ?? []).map(String);
  const priceGroups: number[] = (inventory.price_groups ?? []).map(Number);

  console.log(`\nInventory:    ${inventory.name} (id ${inventoryId})`);
  console.log(`Warehouses:   ${warehouses.join(", ") || "(none)"}`);
  console.log(`Price groups: ${priceGroups.join(", ") || "(none)"}`);

  const WAREHOUSE_NAME = "Medusa Seed Warehouse";
  const PRICE_GROUP_NAME = "Medusa Seed EUR";

  let addedWarehouse: string | undefined;
  let addedPriceGroup: number | undefined;

  if (warehouses.length > 1) {
    console.log("\nWarehouses: already more than one, nothing to add.");
  } else {
    process.stdout.write(`\n-> creating warehouse "${WAREHOUSE_NAME}" ... `);
    await client.call("addInventoryWarehouse", {
      name: WAREHOUSE_NAME,
      description: "Second warehouse used by the medusa-base seed script",
      stock_edition: true,
    });

    // The id format used inside an inventory is prefixed by warehouse type
    // (e.g. "bl_42"), which the create call does not return - so read it back
    // and match on the name rather than composing the id by hand.
    const listed = await client.call("getInventoryWarehouses");
    const created = Object.values(listed.warehouses ?? {}).find(
      (w: any) => w.name === WAREHOUSE_NAME
    ) as any;

    if (!created) {
      console.log("FAILED: created but not found when reading the list back");
      process.exit(1);
    }

    addedWarehouse = `${created.warehouse_type}_${created.warehouse_id}`;
    console.log(`ok (${addedWarehouse})`);
  }

  if (priceGroups.length > 1) {
    console.log("Price groups: already more than one, nothing to add.");
  } else {
    process.stdout.write(`-> creating price group "${PRICE_GROUP_NAME}" ... `);
    await client.call("addInventoryPriceGroup", {
      name: PRICE_GROUP_NAME,
      description: "Second price group used by the medusa-base seed script",
      currency: "EUR",
    });

    const listed = await client.call("getInventoryPriceGroups");
    const created = ((listed.price_groups as any[]) ?? []).find(
      (g: any) => g.name === PRICE_GROUP_NAME
    );

    if (!created) {
      console.log("FAILED: created but not found when reading the list back");
      process.exit(1);
    }

    addedPriceGroup = Number(created.price_group_id);
    console.log(`ok (${addedPriceGroup})`);
  }

  if (!addedWarehouse && !addedPriceGroup) {
    console.log("\nNothing to do - the inventory is already set up for seeding.");
    return;
  }

  // Updating an inventory means resending its full definition, so every
  // existing field is passed through untouched alongside the additions.
  process.stdout.write("-> attaching them to the inventory ... ");
  await client.call("addInventory", {
    inventory_id: inventoryId,
    name: inventory.name,
    description: inventory.description ?? "",
    languages: inventory.languages,
    default_language: inventory.default_language,
    warehouses: addedWarehouse ? [...warehouses, addedWarehouse] : warehouses,
    default_warehouse: inventory.default_warehouse,
    price_groups: addedPriceGroup ? [...priceGroups, addedPriceGroup] : priceGroups,
    default_price_group: inventory.default_price_group,
    reservations: inventory.reservations,
    is_default: inventory.is_default,
  });
  console.log("ok");

  console.log("\nInventory is ready. Next: npm run seed -- --apply");
};

// ----------------------------------------------------------------- order

/**
 * Creates one test order, then attaches a parcel to it manually.
 *
 * Two deliberate constraints:
 *
 * - The parcel is added with `createPackageManual`, which just records a
 *   tracking number. The regular `createPackage` call goes out to the real
 *   courier integration and can produce a billable shipping label.
 * - Orders cannot be deleted through the Base API, only moved to a cancelled
 *   status, so this runs only when asked for explicitly.
 *
 * The point is to capture the shape of getOrders, getOrderPackages and the
 * journal entries that order status sync back to Medusa will be built on.
 */
const seedOrder = async (client: BaseClient) => {
  const state = readState();

  if (!state?.created?.length) {
    console.error(
      "No seeded products found. Run: npm run seed -- --apply first, so the order has real line items."
    );
    process.exit(1);
  }

  const statuses = await client.call("getOrderStatusList");
  const statusList = (statuses.statuses as any[]) ?? [];

  if (!statusList.length) {
    console.error("The account has no order statuses defined.");
    process.exit(1);
  }

  const status = statusList[0];
  console.log(`\nOrder status: ${status.name} (id ${status.id})`);

  // Two line items: a standalone product and a variant, so the captured order
  // covers both shapes the export workflow will have to produce.
  const lineItems = [
    state.created.find((c) => c.key === "simple-no-variants"),
    state.created.find((c) => c.key === "two-variants/size-l"),
  ].filter(Boolean) as SeedState["created"];

  if (!lineItems.length) {
    console.error("Could not find seeded products to put on the order.");
    process.exit(1);
  }

  console.log(`Line items:   ${lineItems.map((i) => i.sku).join(", ")}`);

  process.stdout.write("\n-> creating order ... ");

  const response = await client.call("addOrder", {
    order_status_id: Number(status.id),
    date_add: Math.floor(Date.now() / 1000),
    currency: "PLN",
    payment_method: "Test payment",
    payment_method_cod: false,
    paid: 0,
    email: "seed@example.com",
    phone: "600100200",
    user_comments: "Order created by the medusa-base seed script",
    admin_comments: "medusa-base seed - safe to cancel",
    delivery_method: "Test courier",
    delivery_price: 15.99,
    delivery_fullname: "Jan Testowy",
    delivery_address: "ul. Testowa 1",
    delivery_postcode: "00-001",
    delivery_city: "Warszawa",
    delivery_country_code: "PL",
    invoice_fullname: "Jan Testowy",
    invoice_address: "ul. Testowa 1",
    invoice_postcode: "00-001",
    invoice_city: "Warszawa",
    invoice_country_code: "PL",
    want_invoice: false,
    products: lineItems.map((item, index) => ({
      // Inventory-backed order lines are addressed as bl_<inventory_id>.
      storage_id: `bl_${state.inventory_id}`,
      product_id: item.product_id,
      name: item.sku,
      sku: item.sku,
      price_brutto: index === 0 ? 49.99 : 89.0,
      tax_rate: 23,
      quantity: index === 0 ? 2 : 1,
    })),
  });

  const orderId = String((response as any).order_id ?? "");
  console.log(`ok (order_id ${orderId})`);

  const packageNumber = `SEED${Date.now()}`;
  let attachedPackage: string | undefined;

  process.stdout.write("-> attaching a manual parcel ... ");
  try {
    // Manual on purpose: this records a tracking number without contacting
    // any courier, so no real label is bought.
    await client.call("createPackageManual", {
      order_id: orderId,
      courier_code: "inpost",
      package_number: packageNumber,
      pickup_date: Math.floor(Date.now() / 1000),
    });
    attachedPackage = packageNumber;
    console.log(`ok (${packageNumber})`);
  } catch (error) {
    const message =
      error instanceof BaseApiError ? error.message : (error as Error).message;
    console.log(`FAILED: ${message}`);
    console.log(
      "   The order itself was created; only the parcel step failed."
    );
  }

  writeState({
    ...state,
    orders: [
      ...(state.orders ?? []),
      { order_id: orderId, package_number: attachedPackage },
    ],
  });

  console.log("\nOrder recorded in fixtures/raw/seed-state.json.");
  console.log(
    "Note: Base has no API for deleting orders - cancel it in the panel if you want it gone."
  );
  console.log("\nNext: npm run recon");
};

// -------------------------------------------------------------- cleanup

const cleanup = async (client: BaseClient) => {
  const state = readState();

  if (!state?.created?.length) {
    console.log(
      "No seed state found - nothing to clean up. Products created outside this script are never touched."
    );
    return;
  }

  console.log(`Deleting ${state.created.length} seeded products ...\n`);
  const remaining: SeedState["created"] = [];

  // Reverse order deletes variants before their parents. Removing a parent may
  // cascade to its children, and a delete of an already-gone child would then
  // fail and linger in the state file forever.
  for (const entry of [...state.created].reverse()) {
    process.stdout.write(`-> ${entry.key} (${entry.product_id}) ... `);
    try {
      await client.call("deleteInventoryProduct", {
        inventory_id: state.inventory_id,
        product_id: entry.product_id,
      });
      console.log("deleted");
    } catch (error) {
      const message =
        error instanceof BaseApiError ? error.message : (error as Error).message;
      console.log(`FAILED: ${message}`);
      // Keep failures in state so a re-run can retry just those.
      remaining.push(entry);
    }
  }

  writeState({ ...state, created: remaining });

  if (state.orders?.length) {
    console.log(
      `\nNote: ${state.orders.length} seeded order(s) remain - Base has no API for deleting orders.`
    );
    console.log(
      `  order ids: ${state.orders.map((o) => o.order_id).join(", ")}`
    );
  }

  console.log(
    remaining.length
      ? `\n${remaining.length} products could not be deleted and remain in the state file.`
      : "\nAll seeded products removed."
  );
};

main().catch((error) => {
  console.error("\nSeed aborted:", error);
  process.exit(1);
});
