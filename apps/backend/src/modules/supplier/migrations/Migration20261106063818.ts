import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261106063818 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier_product" drop constraint if exists "supplier_product_supplier_id_supplier_sku_key_unique";`);
    this.addSql(`alter table if exists "supplier_product" drop constraint if exists "supplier_product_supplier_id_variant_id_unique";`);
    this.addSql(`create table if not exists "supplier_product" ("id" text not null, "supplier_id" text not null, "variant_id" text not null, "supplier_sku" text not null, "supplier_sku_key" text not null, "supplier_title" text null, "unit_cost" numeric null, "notes" text null, "raw_unit_cost" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_product_supplier_id" ON "supplier_product" ("supplier_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_product_deleted_at" ON "supplier_product" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_product_supplier_id_variant_id_unique" ON "supplier_product" ("supplier_id", "variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_product_supplier_id_supplier_sku_key_unique" ON "supplier_product" ("supplier_id", "supplier_sku_key") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "supplier_product" add constraint "supplier_product_supplier_id_foreign" foreign key ("supplier_id") references "supplier" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "supplier_product" cascade;`);
  }

}
