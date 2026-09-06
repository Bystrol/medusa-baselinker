# Base.com API recon

Generated: 2026-09-06T10:24:15.451Z

Response shapes captured from a live account. They serve as the source of
truth for mappings and for offline tests once the trial expires.

## Key findings

### Price format (do we need to divide by 100?)

Medusa v2 stores prices as-is (49.99 is 49.99, not 4999).
The sample below settles whether Base returns the same:

```json
{
  "product_id": 683543721,
  "prices": {
    "100823": 49.99,
    "100830": 49.99
  }
}
```

### Variants

Products in sample: 11
- with variants: 3
- without variants: 8

Products without variants must receive a single default variant in Medusa,
built from the product's own data (sku/ean/prices), rather than being skipped.

### Base order statuses (to map onto Medusa states)

- `513687` - Nowe zamówienia
- `513688` - Do wysłania
- `513689` - Wysłane
- `513690` - Anulowane
- `513691` - Przykładowy status

### Couriers (for tracking and a later fulfillment provider)

- `acs` - ACS
- `ait` - AIT (Panther)
- `ajioshipping` - Ajio Shipping
- `aliexpressshippingbr` - AliExpress Shipping - Brazil
- `aliexpressshippingpl` - AliExpress Shipping - Poland
- `aliexpressshippingus` - AliExpress Shipping - US
- `allegrokurier` - Allegro.pl
- `fulfillmentallegro` - Allegro Fulfillment
- `allekurier` - Allekurier.pl
- `allpacka` - Pactic
- `allpost` - allPost
- `altexshipping` - Altex Shipping
- `alzashipping` - Alza Shipping
- `amazonpack` - Amazon Buy Shipping
- `amazoneasyship` - Amazon Easy Ship
- `amazoneasyshipbr` - Amazon Easy Ship BR
- `amazoneasyshippl` - Amazon Easy Ship EU
- `amazon_self_delivery` - Amazon Self Delivery
- `amazon_self_ship` - Amazon Self Ship
- `amazonshipping` - Amazon Shipping
- `amazonsmartconnect` - Amazon Seller Flex
- `amazonvdf` - Amazon Vendor Direct Fulfillment
- `ambro` - Ambro
- `americanas_entrega` - Americanas Entrega
- `andesmar` - Andesmar
- `andreani` - Andreani
- `angeloni_shipping` - Angeloni Shipping
- `apaczka` - Apaczka
- `apcovernight` - APC Overnight
- `aramex` - Aramex International
- `aramis_shipping` - Aramis Shipping
- `asendia` - Asendia
- `backship_eu` - BackShip By Back Market EU
- `backship_us` - BackShip By Back Market US
- `balikobot` - Balikobot
- `belgo_shipping` - Belgo Shipping
- `blconnectpackages` - Base Connect
- `bliskapaczka` - Bliskapaczka.pl
- `blowhorn` - Blowhorn
- `blpaczka` - Base Courier (BLPaczka)

## Response shapes

### getInventories

Method: `getInventories`

```
  inventories: array[1] of object{inventory_id, name, description, languages, default_language, price_groups, default_price_group, warehouses}
```

### getInventoryWarehouses

Method: `getInventoryWarehouses`

```
  warehouses: array[2] of object{warehouse_type, warehouse_id, internal_warehouse_id, name, description, stock_edition, is_default, address}
```

### getInventoryPriceGroups

Method: `getInventoryPriceGroups`

```
  price_groups: array[2] of object{price_group_id, name, description, currency, is_default, price_group_type, source_price_group_id, price_multiplier}
```

### getInventoryCategories

Method: `getInventoryCategories`

```
  categories: array[0]
```

### getInventoryManufacturers

Method: `getInventoryManufacturers`

```
  manufacturers: array[0]
```

### getInventoryExtraFields

Method: `getInventoryExtraFields`

```
  extra_fields: array[0]
```

### getInventoryProductsStock

Method: `getInventoryProductsStock`

```
  products: object{
      683543721: object{product_id, stock, reservations}
      683543727: object{product_id, stock, reservations, variants, variant_reservations}
      683543744: object{product_id, stock, reservations, variants, variant_reservations}
      683543767: object{product_id, stock, reservations, variants, variant_reservations}
      683543779: object{product_id, stock, reservations}
      683543784: object{product_id, stock, reservations}
      683543786: object{product_id, stock, reservations}
      683543791: object{product_id, stock, reservations}
      683543796: object{product_id, stock, reservations}
      683543802: object{product_id, stock, reservations}
      683543807: object{product_id, stock, reservations}
    }
```

### getInventoryProductsPrices

Method: `getInventoryProductsPrices`

```
  products: object{
      683543721: object{product_id, prices}
      683543727: object{product_id, prices, variants}
      683543744: object{product_id, prices, variants}
      683543767: object{product_id, prices, variants}
      683543779: object{product_id, prices}
      683543784: object{product_id, prices}
      683543786: object{product_id, prices}
      683543791: object{product_id, prices}
      683543796: object{product_id, prices}
      683543802: object{product_id, prices}
      683543807: object{product_id, prices}
    }
```

### getInventoryProductsList

Method: `getInventoryProductsList`

```
  products: object{
      683543721: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543727: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543744: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543767: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543779: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543784: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543786: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543791: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543796: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543802: object{id, ean, asin, sku, name, parent_id, stock, prices}
      683543807: object{id, ean, asin, sku, name, parent_id, stock, prices}
    }
```

### getInventoryProductsData

Method: `getInventoryProductsData`

```
  products: object{
      683543721: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543727: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543744: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543767: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543779: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543784: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543786: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543791: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543796: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543802: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543807: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
    }
```

### getInventoryProductsData_variants

Method: `getInventoryProductsData`

```
  products: object{
      683543731: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543736: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543752: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543758: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543770: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
      683543775: object{is_bundle, ean, asin, parent_id, sku, tags, tax_rate, weight}
    }
```

### getOrderStatusList

Method: `getOrderStatusList`

```
  statuses: array[5] of object{id, name, color, group_id, is_primary, name_for_customer}
```

### getOrderSources

Method: `getOrderSources`

```
  sources: object{
      personal: object{0}
      order_return: object{0}
    }
```

### getOrderExtraFields

Method: `getOrderExtraFields`

```
  extra_fields: array[2] of object{extra_field_id, name, editor_type}
```

### getCouriersList

Method: `getCouriersList`

```
  couriers: array[473] of object{code, name}
```

### getJournalList

Method: `getJournalList`

```
  logs: array[0]
```

### getJournalList_filtered

Method: `getJournalList`

```
  logs: array[0]
```

### getOrders

Method: `getOrders`

```
  orders: array[1] of object{order_id, shop_order_id, external_order_id, order_source, order_source_id, order_source_info, order_status_id, confirmed}
```

### getOrderPackages

Method: `getOrderPackages`

```
  packages: array[1] of object{package_id, courier_package_nr, courier_inner_number, courier_code, courier_other_name, account_id, tracking_status_date, tracking_delivery_days}
```
