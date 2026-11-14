import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261114120650 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "order_event" ("id" text not null, "order_id" text not null, "type" text not null, "actor" text not null, "old_value" jsonb null, "new_value" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_event_deleted_at" ON "order_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_event_order_id_created_at" ON "order_event" ("order_id", "created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_event" cascade;`);
  }

}
