# medusa-baselinker

Two-way integration between [Medusa v2](https://medusajs.com) and
[Base.com](https://base.com) (formerly BaseLinker).

Base owns the catalog and the warehouse; Medusa is the storefront. Products,
prices and stock flow one way, orders flow the other, and shipment status
comes back — so a customer sees a tracking number rather than an order stuck
at "not fulfilled" forever.

| Data | Direction | Trigger |
| --- | --- | --- |
| Products, variants, options, prices, images | Base → Medusa | scheduled job, or on demand |
| Stock levels | Base → Medusa | scheduled job (more frequent) |
| Orders | Medusa → Base | `order.placed` |
| Order status, tracking number | Base → Medusa | scheduled job |

The catalog is never pushed from Medusa to Base, which removes write conflicts
entirely.

## Install

```bash
npm install medusa-baselinker
```

Add it to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "medusa-baselinker",
      options: {
        api_key: process.env.BASE_API_KEY,
      },
    },
  ],
})
```

Then create the plugin's tables:

```bash
npx medusa db:migrate
```

Get the API key from the Base.com panel under **My account → API**.

## Options

Only `api_key` is required. Everything else has a default, and the ones that
fall back log a warning naming what they picked.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `api_key` | `string` | — | **Required.** API key from the Base.com panel. |
| `inventory_id` | `string` | account default | Which Base inventory to sync. |
| `sales_channel_id` | `string` | first channel | Sales channel imported products are linked to. Set it on a store with more than one. |
| `shipping_profile_id` | `string` | first profile | Shipping profile assigned to imported products. |
| `order_status_id` | `number` | first status | Status given to orders exported to Base. |
| `custom_source_id` | `number` | — | Order source shown in Base for orders from Medusa. |
| `shipped_status_ids` | `(string \| number)[]` | `[]` | Base statuses meaning "shipped". Usually unnecessary — an order that acquires a tracking number is treated as shipped anyway. |
| `missing_product_strategy` | `"draft" \| "delete" \| "ignore"` | `"draft"` | What happens to a product that disappears from Base. |
| `max_missing_ratio` | `number` | `0.2` | Largest share of products one sync may withdraw before refusing to act. |
| `order_sync_lookback_days` | `number` | `30` | How far back the order status sync looks. |
| `cod_payment_providers` | `string[]` | `[]` | Payment provider ids that mean cash on delivery. |
| `payment_method_labels` | `Record<string, string>` | `{}` | Friendly payment names per provider id. |
| `pickup_point_data_keys` | `string[]` | `["target_point", "point_id", "pickup_point_id"]` | Where to find the pickup point id in a shipping method's data. |
| `requests_per_minute` | `number` | `100` | Base's own limit. Lower it to leave room for other clients. |

### Why `missing_product_strategy` defaults to draft

A product missing from Base is inferred from a paginated listing, and a timed
out page, a changed `inventory_id` or a broken pagination loop all look exactly
like a mass deletion. A draft product is gone from the storefront for every
practical purpose — the Store API filters on published status and the cart
rejects variants of unpublished products — but it keeps its handle, its history
and its mapping, so a false alarm costs one sync instead of a full reimport.

`max_missing_ratio` guards both strategies, and a response containing no
products at all is refused outright whatever the ratio allows.

## Schedules

Job schedules are read at load time, before plugin options exist, so they come
from environment variables:

| Variable | Default | Runs |
| --- | --- | --- |
| `BASE_CATALOG_SYNC_CRON` | `0 */6 * * *` | Full catalog import |
| `BASE_STOCK_SYNC_CRON` | `*/15 * * * *` | Stock levels only |
| `BASE_ORDER_SYNC_CRON` | `*/10 * * * *` | Order status and tracking |

Set any of them to `off` to disable that job.

Stock runs far more often than the catalog on purpose: it is the figure that
goes stale fastest, it is the one that costs a refund when it does, and one
request covers the whole inventory.

## Manual endpoints

All admin routes, all safe to call repeatedly.

| Route | Effect |
| --- | --- |
| `POST /admin/base/sync` | Full catalog import, including stock |
| `POST /admin/base/stock` | Stock levels only |
| `POST /admin/base/orders/sync` | Pull order status and tracking from Base |
| `POST /admin/base/orders/:id/export` | Retry the export of one order |

## How variants and options are handled

Base has no concept of an option axis. A variant there is a separate product
carrying a `parent_id`, identified by a free-text name.

Where every variant of a product declares the same **features** — the key/value
map Base keeps in a product's text fields — those keys become real Medusa
options, so a storefront gets separate Colour and Size selectors. Where the
features are missing, inconsistent between variants, or would put two variants
on the same combination, the import falls back to a single generated option
whose values are the variant names. An honest one-dimensional list beats a
broken two-dimensional one.

Features are only visible when a variant is fetched as a product of its own, so
the catalog sync makes a second batched pass for them.

Products Base holds without any variants get a single default variant rather
than being skipped.

## Order export

Base has no idempotency key: calling `addOrder` twice creates two orders, and
the API cannot delete either. The mapping row is therefore written *before* the
call, and an order that already carries a Base id is skipped, so a retry —
from a redelivered event, a restarted worker or an operator — is safe.

Failures are recorded on the mapping rather than thrown. A missing variant
mapping or a rejected payload will not fix itself on the next attempt, and an
exception would only bury it in a subscriber stack trace. Check `export_error`:

```sql
select medusa_order_id, export_error from base_order_mapping
where export_error is not null;
```

Fix the cause, then `POST /admin/base/orders/:id/export`.

An order with any unmapped line is not sent at all: a partial order would
understate what the warehouse has to pack.

## Delivery and pickup points

The shipping method the customer chose is sent as its name and price. Base is
not asked which courier that is: mapping a delivery method to one of its 473
couriers is what Base's own automatic actions are for, and that rule belongs
where the merchant can edit it rather than in a plugin release.

What the plugin does pass is the **pickup point**, when the checkout produced
one. Base reads the locker or parcel shop from the order's
`delivery_point_id` — the courier's own parcel form has no field for it — so
without this an operator has to paste the point id in by hand for every
parcel, and no automatic action can create the shipment.

Where that id sits depends on whichever plugin handled the checkout, and
carriers agree on no convention, so the keys are configuration:

```ts
pickup_point_data_keys: ["target_point", "point_id", "pickup_point_id"],
```

The defaults cover the common cases, including the `target_point` written by
[medusa-inpost-fulfillment](https://www.npmjs.com/package/medusa-inpost-fulfillment),
so a Paczkomat order works without configuring anything. Dotted paths reach a
nested value (`point.id`). An order delivered to an address names no point and
is unaffected.

Only the id is sent. Base also stores a point name and address, but carrier
plugins do not consistently keep them, so those fields stay empty — the id is
what a shipment needs.

## Payment

Base never takes money. Payment runs through a Medusa provider, and Base is
only told the operational consequence: what has been collected, and whether
the courier still has to collect the rest.

```ts
cod_payment_providers: ["pp_system_default"],
payment_method_labels: { pp_system_default: "Cash on delivery" },
```

**`cod_payment_providers` has to be configured if you sell cash on delivery.**
Medusa has no such concept — it is a manual provider, a custom one, or
sometimes a shipping option — so the plugin cannot infer it. The flag decides
whether the courier collects money on delivery and what goes on the label: a
cash-on-delivery order sent as prepaid ships without collecting anything.

What Base receives:

| Order | `payment_method_cod` | Amount recorded as paid |
| --- | --- | --- |
| Provider listed in `cod_payment_providers` | yes | 0 |
| Payment captured | no | the captured amount |
| Payment authorized but not captured | no | 0 |

An authorization is money reserved, not money taken, so it counts as unpaid —
the warehouse cares about what has actually arrived.

The amount is sent with a separate `setOrderPayment` call, because `addOrder`
accepts a `paid` field and silently ignores it. A payment captured *after* the
order was exported is not pushed to Base; record it there by hand.

## What this plugin does not do

- **No fulfillment provider.** Base's shipping methods are not available in the
  Medusa checkout; the store's own shipping options are used and their name is
  passed along with the order.
- **No returns or cancellations from Base.** Status and tracking come back;
  a cancellation in Base does not cancel the Medusa order.
- **No payment sync after export.** The amount paid is sent once, when the
  order is exported. Capturing a payment later does not update Base.
- **No catalog push.** Products created in Medusa stay in Medusa.
- **Stock is written, not adjusted.** Each sync writes the quantity Base
  reports. This is deliberate: a missed run or a double-applied delta would
  leave Medusa permanently out of step, whereas writing the value is
  self-correcting.

## Development

The repository carries recorded API responses in `fixtures/`, so the mapping
layer is fully testable without a Base account:

```bash
npm test
```

Two scripts talk to a real account:

```bash
npm run recon              # dump API responses into fixtures/
npm run seed               # show what test products would be created
npm run seed -- --setup    # add a second warehouse and price group
npm run seed -- --apply    # create the test products
npm run seed -- --order    # create one test order with a manual parcel
npm run seed -- --cleanup  # remove only what the seed created
```

The seeded products are chosen to hit specific edge cases: a product without
variants, variants with and without consistent features, two products sharing a
name, diacritics in a title, stock split across warehouses, and a price that
differs per price group.

`npm run seed -- --order` attaches a parcel with `createPackageManual`, which
records a tracking number without contacting any courier, so it cannot produce
a billable shipping label.

## Licence

MIT
