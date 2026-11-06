import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261106061859 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier" add column if not exists "contact_name" text null, add column if not exists "website" text null, add column if not exists "tax_id" text null, add column if not exists "payment_terms" text null, add column if not exists "lead_time_days" integer null, add column if not exists "is_active" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "supplier" drop column if exists "contact_name", drop column if exists "website", drop column if exists "tax_id", drop column if exists "payment_terms", drop column if exists "lead_time_days", drop column if exists "is_active";`);
  }

}
