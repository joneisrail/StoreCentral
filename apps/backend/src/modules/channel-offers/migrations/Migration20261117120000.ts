import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261117120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "channel_offer" ("id" text not null, "variant_id" text not null, "sales_channel_id" text not null, "price" real null, "stock" int not null default 0, "last_synced_price" real null, "last_synced_stock" int null, "last_synced_at" timestamptz null, "sync_state" text not null default 'pending', "last_error" text null, "channel_order" int not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "channel_offer_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_offer_deleted_at" ON "channel_offer" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_offer_sales_channel_id" ON "channel_offer" ("sales_channel_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_offer_variant_channel_unique" ON "channel_offer" ("variant_id", "sales_channel_id") WHERE deleted_at IS NULL;`);
    this.addSql(`create table if not exists "channel_stock_movement" ("id" text not null, "kind" text not null, "variant_id" text not null, "sales_channel_id" text not null, "delta" int not null, "ref" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "channel_stock_movement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_stock_movement_deleted_at" ON "channel_stock_movement" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_stock_movement_kind_ref_variant_channel_unique" ON "channel_stock_movement" ("kind", "ref", "variant_id", "sales_channel_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_stock_movement_variant_id" ON "channel_stock_movement" ("variant_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "channel_offer" cascade;`);
    this.addSql(`drop table if exists "channel_stock_movement" cascade;`);
  }

}
