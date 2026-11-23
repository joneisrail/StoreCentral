# Runbook

Operating the StoreCentral compose stack on one server. All commands run from the repository root. Secrets are described in [secrets.md](./secrets.md); memory limits in [memory.md](./memory.md).

Every `docker compose` command below uses `-f deploy/docker-compose.yml`. Compose reads `deploy/.env` automatically because the compose file sits in `deploy/`; if yours does not, add `--env-file deploy/.env`.

## First deploy

1. Install Docker with the compose plugin. Point DNS for `STORE_HOST`, `ADMIN_HOST`, `POS_HOST` and `HUB_HOST` at the server; open ports 80 and 443 (TCP and UDP).
2. Clone the repository and check out the release.
3. `cp deploy/.env.example deploy/.env`, then fill every value. Generate secrets with `openssl rand -hex 32` (see secrets.md). Never commit `deploy/.env`.
4. Build the images first. `migrate` uses `pull_policy: never` and reuses the image the backend service builds, so `up -d` without a prior build fails:

   ```
   docker compose -f deploy/docker-compose.yml build
   ```

5. Start the stack:

   ```
   docker compose -f deploy/docker-compose.yml up -d
   ```

   Postgres runs major version 15 (`postgres:15-alpine`, the same major CI uses). Changing the major version later is not an in-place upgrade of the volume: take a dump, start the new version on an empty volume and restore it.

   Postgres creates the `medusa` and `seller_hub` roles on its first start only. `migrate` then runs and the backend starts after it completes.
6. Create the first admin user inside the backend container. Do not type the password on the command line, where it lands in shell history and the process list. Read it from a prompt (or a temporary file readable only by you, deleted afterwards):

   ```
   read -r -s -p "Admin password: " ADMIN_PW; echo
   docker compose -f deploy/docker-compose.yml exec -e ADMIN_PW backend sh -c 'medusa user -e <email> -p "$ADMIN_PW"'
   unset ADMIN_PW
   ```

   The prompt uses `read -s`, which is a bash feature, so run these lines in bash. The password is still briefly visible in the container's process list while `medusa user` runs.

   Use the same email and password as `MEDUSA_ADMIN_EMAIL` and `MEDUSA_ADMIN_PASSWORD` in `deploy/.env`, because seller-hub signs in with them. `MEDUSA_ADMIN_PASSWORD` is a secret with a 32-character minimum; generate it with `openssl rand -hex 32`. `AUTH_MFA_ENCRYPTION_KEY` may be left empty, but if you set it, it must be at least 32 characters. If you set them after the first start, update `deploy/.env` and recreate the service with `docker compose -f deploy/docker-compose.yml up -d seller-hub` (a plain restart does not re-read `.env`).
7. Until Amazon goes live, seller-hub's SQS poll fails with `CredentialsProviderError` because `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are empty. This is harmless log noise. Set real keys (or use an instance role) at go-live.
8. Run the first smoke test below.

## First smoke test

| Check | Expected |
| --- | --- |
| `docker compose -f deploy/docker-compose.yml ps` | All services running; backend, seller-hub, storefront, pos healthy; `migrate` exited 0 |
| `https://<ADMIN_HOST>/app` | Admin login page loads; you can sign in |
| Upload a product image in the admin | Upload succeeds and the image displays. The backend image only chowns `.medusa/server` and `static`, so this proves the file service can write |
| `https://<ADMIN_HOST>/health` | 200 |
| `https://<STORE_HOST>/` | Storefront renders (it has no `/health`; the root page is its check) |
| `https://<POS_HOST>/` | POS loads |
| seller-hub health, from inside the network only: `docker compose -f deploy/docker-compose.yml exec seller-hub node -e "fetch('http://127.0.0.1:7005/health').then(r=>console.log(r.status))"` | 200 |
| `curl -s -o /dev/null -w '%{http_code}' https://<HUB_HOST>/anything` | 404: Caddy answers 404 for every path on `HUB_HOST` except `/webhooks/*` |
| Backup then restore drill | See the quarterly drill below; the restore into a scratch database succeeds |

## Update procedure

1. Back up first: `sh deploy/backup.sh /srv/storecentral-backups`. Note the current image ids (`docker images 'storecentral/*'`) so you can roll back.
2. Pull the new code: `git pull`.
3. Build: `docker compose -f deploy/docker-compose.yml build`. If a `NEXT_PUBLIC_*` value changed, this rebuild of the storefront is what applies it.
4. Run migrations: `docker compose -f deploy/docker-compose.yml up -d migrate`, and wait for it to exit 0 (`ps`; `logs migrate` on failure).
5. Restart in this order, one at a time, checking health between steps:
   1. backend: `docker compose -f deploy/docker-compose.yml up -d backend`
   2. seller-hub: `docker compose -f deploy/docker-compose.yml up -d seller-hub`
   3. storefront: `docker compose -f deploy/docker-compose.yml up -d storefront`
6. Run `up -d` once more for anything else that changed (pos, caddy), then repeat the smoke test.

## Rollback

1. Stop the services that changed: `docker compose -f deploy/docker-compose.yml stop storefront seller-hub backend`.
2. Go back to the previous version: check out the previous release (`git checkout <previous-tag>`) and rebuild, or re-tag the previous image (`docker tag <previous-image-id> storecentral/backend:local`, and the same for the other services). Images are tagged `:local`, which is why the previous ids are recorded before an update.
3. If the update ran migrations that the previous code cannot work with, restore the database too: restore the pre-update backup into a scratch database with `deploy/restore.sh` (below), verify it, and swap it in by hand while the backend is stopped. `restore.sh` never touches the live database, by design.
4. Start the old version and repeat the smoke test.

## Reading health

| Service | How to check | Healthy |
| --- | --- | --- |
| backend | `https://<ADMIN_HOST>/health`, or `ps` | 200 / healthy |
| seller-hub | from inside the network only (command in the smoke test) | 200 |
| storefront | `https://<STORE_HOST>/` | status below 500 |
| pos | `https://<POS_HOST>/` | 200 |
| postgres | `docker compose -f deploy/docker-compose.yml exec postgres pg_isready` | accepting connections |
| redis | `ps` health column | healthy |
| caddy | `ps` health column; `logs caddy` | healthy |

## When a health check fails

Start with `docker compose -f deploy/docker-compose.yml ps` and `logs --tail 100 <service>`. Logs name variables, never values.

| Failing | Likely cause | Action |
| --- | --- | --- |
| Any Node service exits at start | `check-env` rejected the configuration (missing, placeholder or too-short secret) | Read the logged variable names, fix `deploy/.env`, `up -d <service>` |
| backend unhealthy | Database or Redis unreachable, migration failed, wrong `MEDUSA_DB_PASSWORD` | Check postgres and redis health, then `logs migrate`, then `logs backend` |
| `migrate` exited non-zero | Migration error, or the image was not built first | Build first; read `logs migrate`; do not start the backend until it exits 0 |
| seller-hub unhealthy | Backend not healthy yet, bad `MEDUSA_ADMIN_*` credentials, invalid Amazon/AWS values, wrong `SELLER_HUB_DB_PASSWORD` | Fix the backend first, then check `logs seller-hub` |
| storefront unhealthy | Backend unreachable, or a `NEXT_PUBLIC_*` value was wrong at build time | Check the backend; rebuild storefront after correcting the value |
| pos unhealthy | Container failed to start | `logs pos`; rebuild |
| postgres unhealthy | Disk full, damaged volume, memory limit | `logs postgres`; `df -h`; restore from backup if the volume is damaged |
| redis unhealthy | Wrong password, memory limit | `logs redis`; confirm `REDIS_PASSWORD` |
| HTTPS fails but containers are healthy | DNS or certificate issuance | `logs caddy`; confirm DNS and ports 80 and 443 |
| Admin sign-in loops | `COOKIE_SECRET` or the CORS hosts changed | Confirm `STORE_HOST` and `ADMIN_HOST`, then recreate backend with `docker compose -f deploy/docker-compose.yml up -d backend` (a plain restart does not re-read `.env`) |

## Backups

```
sh deploy/backup.sh /srv/storecentral-backups
```

Writes `storecentral-<UTC timestamp>.dump` (pg_dump custom format) and prints its path only. Dumps are created owner-only (`umask 077`) because they hold customer data. Run it from cron at least daily and copy the dumps off the server. The dump holds encrypted marketplace credentials; keep `ENCRYPTION_KEY` backed up separately and securely, or those credentials cannot be read after a restore.

Restore into a scratch database. The name must end in `_restore` or `_test`; any other name is refused before any docker or database call:

```
sh deploy/restore.sh /srv/storecentral-backups/storecentral-<stamp>.dump storecentral_restore
```

## Quarterly restore drill

A backup that has never been restored is not a backup. Every quarter:

1. Take a fresh backup with `deploy/backup.sh`.
2. Restore it with `deploy/restore.sh <dump> drill_restore`.
3. Check the data, for example a row count:
   `docker compose -f deploy/docker-compose.yml exec postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d drill_restore -c "select count(*) from product"'`
4. Drop the scratch database:
   `docker compose -f deploy/docker-compose.yml exec postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -c "drop database drill_restore"'`
5. Record the date and the result. On a machine with Docker, `sh deploy/backup.test.sh` also runs the automated drill against a throwaway container.

## Test databases

Tests never run against the real database. Create a separate database whose name ends in `_test` on a LOCAL or CI Postgres, never on the dev, staging or production database. Example against a local server:

```
createdb -h localhost -U <user> hub_test
```

| Suite | Variable | Value |
| --- | --- | --- |
| seller-hub (vitest) | `TEST_DATABASE_URL` | `postgres://<user>:<password>@localhost:5432/hub_test`. The name must end in `_test`; otherwise the suite refuses to start. The suite copies it into `DATABASE_URL` for the run and never reads your real `DATABASE_URL` |
| backend integration | `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD` | A local or CI Postgres. Medusa creates and drops its own `medusa-<id>-integration-<n>` databases on it, so give it a role that may create databases. Optional `DB_TEMP_NAME` must start with `medusa-` or end in `_test` |
| backend Redis lock spec | `REDIS_TEST_URL` | For example `redis://localhost:6379/15`; the spec is skipped when unset |

CI sets all of these on throwaway service containers (see `.github/workflows/ci.yml`). Tests that still need CI verification are listed in `deploy/ci-watchlist.md`.

## Importing a channel's products

On a connected WooCommerce or Shopify channel, the sales channel page has a
product import panel. **Check products** reads the channel catalogue and
groups it against the store by SKU: matched, not yet in the store, duplicate
SKU, and no SKU. It writes nothing. **Import selected** (or **Import all**)
creates one draft product per selected unmatched listing and links it to the
channel listing.

- Drafts are never published. Review and publish them in the admin yourself.
- Import pushes nothing to the channel. It only reads from it.
- Each channel listing becomes its own draft product; variations are not
  grouped into one product.
- At most 200 products are created per run. The rest come back as
  "deferred"; run the import again.
- Listings without a SKU, or with a SKU that appears more than once, are only
  reported and never imported.
- A listing with an empty price fails with "channel listing has no price".
- If the draft was created but its starting stock failed, the draft is still
  linked and the SKU is recorded as failed, so a retry does not create a
  second product.
- The currency is checked only when the channel reports one. The WooCommerce
  and Shopify readers do not, so a mixed-currency channel imports at face
  value in the store's default currency.

Read failures with:

```sql
select external_id, status, last_error from seller_hub.sync_job
where sync_type = 'product' order by updated_at desc;
```

## Reading the sync-status panel

Every Shopify or WooCommerce sales channel page has a **Sync status** panel
under the connection details, including read-only (legacy) connections. It
only reads: it starts, retries or changes nothing. It loads when the page
opens, re-reads every 30 seconds while the tab is visible, and **Refresh**
re-reads at once. Amazon has no panel.

The numbers come from seller-hub's own tables for that connection:

- **Linked listings**: rows in `seller_hub.channel_listing`, split by listing
  status (published, draft, error, and so on).
- **With error**: listings whose `last_error` is set (the channel rejected the
  last push).
- **Never pushed**: linked listings with no stock pushed yet
  (`last_synced_quantity` is null). Imported listings start with a baseline
  and are not counted.
- **Job table**: per kind (products, inventory, prices, orders, tracking) the
  `seller_hub.sync_job` rows that are pending, processing or failed, and when
  that kind last succeeded ("Never" if it has not).
- **Recent failures**: the newest 25 failed `seller_hub.sync_job` rows with
  the SKU or id, attempts and the (sanitized, shortened) error. "Showing N of
  M" means there are more; read them with the query under "Importing a
  channel's products" without the `sync_type` filter.

Two states look different on purpose:

- **Red banner "Seller-hub is not reachable"** with a Retry button and no
  numbers: the backend could not get an answer from seller-hub (for example
  502 `seller_hub_unavailable`). Check seller-hub health first (see
  "Reading health").
- **Notice "Sync is not running"** with numbers shown: seller-hub answered,
  but no live sync runs for this connection (stopped after an error, or
  legacy). The numbers are the last stored values. A passing **Test** on the
  connection turns sync back on.

## Known unverified items

These were written without a Docker host available. They are verified only by the first CI run or the first real deployment, so treat a failure in any of them as plausible, not surprising:

- The Docker image builds for backend, seller-hub, storefront and pos.
- `yarn workspaces focus` in the Dockerfiles resolving the right dependencies.
- `medusa start` running from `.medusa/server` in the backend image.
- Migrations running under the restricted `medusa` database role.
- The Medusa Redis modules booting with `BACKEND_REDIS_MODULES=true`.
- AWS credentials for seller-hub: not set until Amazon goes live; the SQS poll logs `CredentialsProviderError` until real keys (or an instance role) are provided.
- `deploy/backup.test.sh` (the disposable-container drill) has not been executed yet.
