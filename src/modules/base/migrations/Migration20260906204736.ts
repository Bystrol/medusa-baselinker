import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260906204736 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "base_order_mapping" add column if not exists "fulfilled_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "base_order_mapping" drop column if exists "fulfilled_at";`);
  }

}
