import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261105192528 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "purchase" ("id" text not null, "display_id" serial, "status" text check ("status" in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')) not null default 'draft', "currency_code" text not null default 'usd', "shipping_cost" numeric not null default 0, "tax" numeric not null default 0, "other_cost" numeric not null default 0, "notes" text null, "ordered_at" timestamptz null, "raw_shipping_cost" jsonb not null default '{"value":"0","precision":20}', "raw_tax" jsonb not null default '{"value":"0","precision":20}', "raw_other_cost" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_deleted_at" ON "purchase" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_item" ("id" text not null, "purchase_id" text not null, "variant_id" text not null, "sku" text not null, "title" text not null, "quantity" integer not null, "quantity_received" integer not null default 0, "unit_cost" numeric not null, "raw_unit_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_item_purchase_id" ON "purchase_item" ("purchase_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_item_deleted_at" ON "purchase_item" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_receipt" ("id" text not null, "purchase_id" text not null, "stock_location_id" text not null, "received_at" timestamptz not null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_receipt_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_receipt_purchase_id" ON "purchase_receipt" ("purchase_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_receipt_deleted_at" ON "purchase_receipt" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_receipt_item" ("id" text not null, "receipt_id" text not null, "purchase_item_id" text not null, "quantity" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_receipt_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_receipt_item_receipt_id" ON "purchase_receipt_item" ("receipt_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_receipt_item_deleted_at" ON "purchase_receipt_item" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "purchase_item" add constraint "purchase_item_purchase_id_foreign" foreign key ("purchase_id") references "purchase" ("id") on update cascade;`);

    this.addSql(`alter table if exists "purchase_receipt" add constraint "purchase_receipt_purchase_id_foreign" foreign key ("purchase_id") references "purchase" ("id") on update cascade;`);

    this.addSql(`alter table if exists "purchase_receipt_item" add constraint "purchase_receipt_item_receipt_id_foreign" foreign key ("receipt_id") references "purchase_receipt" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "purchase_item" drop constraint if exists "purchase_item_purchase_id_foreign";`);

    this.addSql(`alter table if exists "purchase_receipt" drop constraint if exists "purchase_receipt_purchase_id_foreign";`);

    this.addSql(`alter table if exists "purchase_receipt_item" drop constraint if exists "purchase_receipt_item_receipt_id_foreign";`);

    this.addSql(`drop table if exists "purchase" cascade;`);

    this.addSql(`drop table if exists "purchase_item" cascade;`);

    this.addSql(`drop table if exists "purchase_receipt" cascade;`);

    this.addSql(`drop table if exists "purchase_receipt_item" cascade;`);
  }

}
