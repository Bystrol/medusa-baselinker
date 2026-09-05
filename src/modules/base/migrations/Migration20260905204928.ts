import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905204928 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "base_variant_mapping" drop constraint if exists "base_variant_mapping_medusa_variant_id_unique";`);
    this.addSql(`alter table if exists "base_variant_mapping" drop constraint if exists "base_variant_mapping_base_variant_id_unique";`);
    this.addSql(`alter table if exists "base_sync_state" drop constraint if exists "base_sync_state_key_unique";`);
    this.addSql(`alter table if exists "base_product_mapping" drop constraint if exists "base_product_mapping_medusa_product_id_unique";`);
    this.addSql(`alter table if exists "base_product_mapping" drop constraint if exists "base_product_mapping_base_product_id_unique";`);
    this.addSql(`alter table if exists "base_order_mapping" drop constraint if exists "base_order_mapping_medusa_order_id_unique";`);
    this.addSql(`alter table if exists "base_location_mapping" drop constraint if exists "base_location_mapping_base_warehouse_id_unique";`);
    this.addSql(`create table if not exists "base_location_mapping" ("id" text not null, "base_warehouse_id" text not null, "medusa_location_id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "base_location_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_location_mapping_base_warehouse_id_unique" ON "base_location_mapping" ("base_warehouse_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_location_mapping_medusa_location_id" ON "base_location_mapping" ("medusa_location_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_location_mapping_deleted_at" ON "base_location_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "base_order_mapping" ("id" text not null, "medusa_order_id" text not null, "base_order_id" text null, "base_status_id" text null, "tracking_number" text null, "courier_code" text null, "export_error" text null, "exported_at" timestamptz null, "last_synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "base_order_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_order_mapping_medusa_order_id_unique" ON "base_order_mapping" ("medusa_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_order_mapping_base_order_id" ON "base_order_mapping" ("base_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_order_mapping_deleted_at" ON "base_order_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "base_product_mapping" ("id" text not null, "base_product_id" text not null, "medusa_product_id" text not null, "handle" text not null, "last_synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "base_product_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_product_mapping_base_product_id_unique" ON "base_product_mapping" ("base_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_product_mapping_medusa_product_id_unique" ON "base_product_mapping" ("medusa_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_product_mapping_deleted_at" ON "base_product_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "base_sync_state" ("id" text not null, "key" text not null, "value" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "base_sync_state_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_sync_state_key_unique" ON "base_sync_state" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_sync_state_deleted_at" ON "base_sync_state" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "base_variant_mapping" ("id" text not null, "base_variant_id" text not null, "base_product_id" text not null, "medusa_variant_id" text not null, "sku" text null, "ean" text null, "is_synthetic" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "base_variant_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_variant_mapping_base_variant_id_unique" ON "base_variant_mapping" ("base_variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_variant_mapping_base_product_id" ON "base_variant_mapping" ("base_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_base_variant_mapping_medusa_variant_id_unique" ON "base_variant_mapping" ("medusa_variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_base_variant_mapping_deleted_at" ON "base_variant_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "base_location_mapping" cascade;`);

    this.addSql(`drop table if exists "base_order_mapping" cascade;`);

    this.addSql(`drop table if exists "base_product_mapping" cascade;`);

    this.addSql(`drop table if exists "base_sync_state" cascade;`);

    this.addSql(`drop table if exists "base_variant_mapping" cascade;`);
  }

}
