import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261127140510 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "search_query" drop constraint if exists "search_query_query_unique";`);
    this.addSql(`create table if not exists "search_query" ("id" text not null, "query" text not null, "count" integer not null default 1, "last_seen_at" timestamptz not null, "results_count" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "search_query_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_search_query_query_unique" ON "search_query" ("query") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_query_deleted_at" ON "search_query" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "search_query" cascade;`);
  }

}
