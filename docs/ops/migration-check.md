# Channel-offers migration check

Verifies, against a throwaway database, that the hand-written migration `apps/backend/src/modules/channel-offers/migrations/Migration20261117120000.ts` creates exactly what the models define, that it rolls back cleanly, and that Medusa would generate nothing further. It is executed once by one agent after the owner's go-ahead (gate G1) and the outcome is recorded in the Results section at the end.

Rule for anything the check finds: fix it with a NEW migration. Never edit `Migration20261117120000.ts` (AGENTS.md).

All commands run from `apps/backend` unless stated. Never print a connection string or password; read credentials from the shell environment.

## 1. Preconditions

1. The owner has said go ahead. Without it, stop.
2. The only database this check may touch is `channel_offers_scratch_test`. The dev database is never connected to, not even to read.
3. Credentials come from the shell environment (for example `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`), not from a `.env` file, and are never echoed.
4. Refuse if the scratch database already exists: `psql -d postgres -Atc "select 1 from pg_database where datname='channel_offers_scratch_test'"` must print nothing. If it prints `1`, stop and tell the owner; do not drop or reuse it.

## 2. Create the database

Command: `psql -d postgres -c "create database channel_offers_scratch_test"`

Expected: `CREATE DATABASE`.

From here on, whatever happens, step 9 (drop) must run.

## 3. Run the migrations against it

Point `DATABASE_URL` at the scratch database for this one command only, built from the environment without printing it (for example `DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/channel_offers_scratch_test"`), then:

```
npx medusa db:migrate
```

(AGENTS.md database section: `<pm> exec medusa db:migrate`, run in `apps/backend`.) The database is empty, so this runs every module's migrations, including channel-offers.

Expected: exits 0 and the log lists the channel-offers migration `Migration20261117120000` as run. If any other module's migration fails, record it and go to step 9; it is not a channel-offers finding.

## 4. Verify the two tables

Run against the scratch database only: `psql -d channel_offers_scratch_test -c "\d channel_offer"` and `... -c "\d channel_stock_movement"`.

Expected for `channel_offer`:

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | text | no | none (primary key `channel_offer_pkey`) |
| `variant_id` | text | no | none |
| `sales_channel_id` | text | no | none |
| `price` | numeric | yes | none |
| `stock` | integer | no | `0` |
| `last_synced_price` | numeric | yes | none |
| `last_synced_stock` | integer | yes | none |
| `last_synced_at` | timestamptz | yes | none |
| `sync_state` | text | no | `'pending'` |
| `last_error` | text | yes | none |
| `channel_order` | integer | no | `0` |
| `raw_price` | jsonb | yes | none |
| `raw_last_synced_price` | jsonb | yes | none |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `deleted_at` | timestamptz | yes | none |

Expected indexes on `channel_offer` (all partial, `WHERE deleted_at IS NULL`): `IDX_channel_offer_deleted_at` on `deleted_at`; `IDX_channel_offer_sales_channel_id` on `sales_channel_id`; `IDX_channel_offer_variant_channel_unique`, UNIQUE on `(variant_id, sales_channel_id)`.

Expected for `channel_stock_movement`:

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | text | no | none (primary key `channel_stock_movement_pkey`) |
| `kind` | text | no | none |
| `variant_id` | text | no | none |
| `sales_channel_id` | text | no | none |
| `delta` | integer | no | none |
| `ref` | text | yes | none |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `deleted_at` | timestamptz | yes | none |

Expected indexes on `channel_stock_movement` (all partial, `WHERE deleted_at IS NULL`): `IDX_channel_stock_movement_deleted_at` on `deleted_at`; `IDX_channel_stock_movement_variant_id` on `variant_id`; `IDX_channel_stock_movement_kind_ref_variant_channel_unique`, UNIQUE on `(kind, ref, variant_id, sales_channel_id)`.

Any difference from these tables, or from `models/channel-offer.ts` and `models/channel-stock-movement.ts`, is a finding (see step 5).

## 5. Generate: expect nothing new

Command (same `DATABASE_URL`): `npx medusa db:generate channelOffers`, then `git status --short apps/backend/src/modules/channel-offers`.

Expected: no new file under `apps/backend/src/modules/channel-offers/migrations/` and no change to any tracked file.

If a new migration file appears:

1. Read it and compare with `Migration20261117120000.ts` and the models.
2. If the hand-written migration is wrong or incomplete (the generated file adds or alters a column, type, default, nullability or index the real database lacks), keep the generated file and commit it as a NEW migration. Never edit `Migration20261117120000.ts`.
3. If it only differs in a snapshot or formatting (same resulting schema), record that in Results and discard the generated files (`git checkout` for tracked ones, delete the new untracked ones).

## 6. Roll back once

Command (same `DATABASE_URL`): `npx medusa db:rollback channelOffers`

Expected: exits 0, one migration rolled back.

## 7. Confirm both tables are gone

Command: `psql -d channel_offers_scratch_test -Atc "select count(*) from information_schema.tables where table_name in ('channel_offer','channel_stock_movement')"`

Expected: `0`.

## 8. Confirm nothing else was touched

Run `git status --short`. Expected: no change caused by this check (unless step 5 produced a deliberate new migration).

## 9. Always drop the scratch database

Run this even if an earlier step failed:

`psql -d postgres -c "drop database channel_offers_scratch_test"`

Expected: `DROP DATABASE`. If it reports active connections, wait for the Medusa process to exit and retry. Then `psql -d postgres -Atc "select 1 from pg_database where datname='channel_offers_scratch_test'"` prints nothing.

## 10. Confirm the dev database was never connected to

State in Results that every `DATABASE_URL` used named `channel_offers_scratch_test` and that no command ran with the dev database name. Unset the temporary `DATABASE_URL` from the shell.

## Results

Fill in when the check is executed.

| Item | Value |
| --- | --- |
| Date | |
| Executed by | |
| Owner go-ahead given (who, when) | |
| Step 1 preconditions (scratch database absent) | |
| Step 3 migrate | |
| Step 4 tables and indexes match | |
| Step 5 generate produced no new file | |
| Step 5 action taken, if a file appeared | |
| Step 6 rollback | |
| Step 7 tables gone | |
| Step 9 scratch database dropped | |
| Step 10 dev database never connected to | |
| Findings and follow-ups | |
