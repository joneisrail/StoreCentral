import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261106125236 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "invoice" drop constraint if exists "invoice_supplier_id_invoice_number_key_unique";`);
    this.addSql(`create table if not exists "invoice" ("id" text not null, "display_id" serial, "supplier_id" text not null, "purchase_id" text not null, "invoice_number" text not null, "invoice_number_key" text not null, "status" text check ("status" in ('draft', 'posted', 'void')) not null default 'draft', "invoice_date" timestamptz not null, "due_date" timestamptz null, "currency_code" text not null default 'usd', "shipping_cost" numeric not null default 0, "tax" numeric not null default 0, "other_cost" numeric not null default 0, "notes" text null, "posted_at" timestamptz null, "voided_at" timestamptz null, "raw_shipping_cost" jsonb not null default '{"value":"0","precision":20}', "raw_tax" jsonb not null default '{"value":"0","precision":20}', "raw_other_cost" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "invoice_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_invoice_deleted_at" ON "invoice" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_invoice_supplier_id_invoice_number_key_unique" ON "invoice" ("supplier_id", "invoice_number_key") WHERE status != 'void' AND deleted_at IS NULL;`);

    this.addSql(`create table if not exists "invoice_item" ("id" text not null, "invoice_id" text not null, "purchase_item_id" text null, "variant_id" text not null, "supplier_sku" text not null, "description" text not null, "quantity" integer not null, "unit_cost" numeric not null, "raw_unit_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "invoice_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_invoice_item_invoice_id" ON "invoice_item" ("invoice_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_invoice_item_deleted_at" ON "invoice_item" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "invoice_item" add constraint "invoice_item_invoice_id_foreign" foreign key ("invoice_id") references "invoice" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "invoice_item" drop constraint if exists "invoice_item_invoice_id_foreign";`);

    this.addSql(`drop table if exists "invoice" cascade;`);

    this.addSql(`drop table if exists "invoice_item" cascade;`);
  }

}
