import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261109195815 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "supplier_payment" ("id" text not null, "display_id" serial, "invoice_id" text not null, "supplier_id" text not null, "amount" numeric not null, "paid_at" timestamptz not null, "method" text check ("method" in ('bank_transfer', 'cash', 'card', 'cheque', 'other')) not null, "reference" text null, "note" text null, "status" text check ("status" in ('recorded', 'void')) not null default 'recorded', "voided_at" timestamptz null, "currency_code" text not null default 'usd', "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_payment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_payment_deleted_at" ON "supplier_payment" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "supplier_payment" cascade;`);
  }

}
