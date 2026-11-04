import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261104205942 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "review" drop constraint if exists "review_customer_id_product_id_unique";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_review_customer_id_product_id_unique" ON "review" ("customer_id", "product_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_review_customer_id_product_id_unique";`);
  }

}
