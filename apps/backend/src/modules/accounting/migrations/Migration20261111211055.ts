import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261111211055 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "expense" ("id" text not null, "display_id" serial, "expense_date" timestamptz not null, "category" text check ("category" in ('rent', 'marketing', 'software', 'payroll', 'shipping_packaging', 'fees', 'utilities', 'other')) not null, "amount" numeric not null, "description" text not null, "payee" text null, "currency_code" text not null default 'usd', "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "expense_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_expense_deleted_at" ON "expense" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "expense" cascade;`);
  }

}
