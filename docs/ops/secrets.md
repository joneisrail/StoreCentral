# Secrets inventory

Every secret the stack uses, who owns it and what happens when it changes. This file lists names and procedures only; no value belongs in it, in git, in a chat or in a ticket.

All values live in `deploy/.env` on the server (copy from `deploy/.env.example`). Generate a value with:

```
openssl rand -hex 32
```

That gives 64 hex characters, which satisfies the 32-character minimum and needs no URL escaping (passwords are placed inside connection URLs). Use the same command for passwords. Generate each secret separately and never reuse one across environments.

## Table

| Name | Owner service | Purpose | How to generate | What breaks on rotation |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | backend | Signs admin and customer API tokens | `openssl rand -hex 32` | All signed-in sessions end; users sign in again. Recreate the service with `docker compose -f deploy/docker-compose.yml up -d backend`. |
| `COOKIE_SECRET` | backend | Signs session cookies | `openssl rand -hex 32` | All sessions end; users sign in again. Recreate the service with `docker compose -f deploy/docker-compose.yml up -d backend`. |
| `AUTH_MFA_ENCRYPTION_KEY` | backend | Encrypts stored multi-factor secrets | `openssl rand -hex 32` | Enrolled MFA secrets become unreadable; affected users must re-enrol. Leave it unchanged unless it leaked. It may be left empty; if set it must be at least 32 characters. |
| `ENCRYPTION_KEY` | seller-hub | Encrypts marketplace and Amazon settings credentials stored in the database (64 hex characters) | `openssl rand -hex 32` | Stored marketplace and Amazon settings credentials become unreadable. After rotating, re-enter every marketplace credential on the admin Marketplace connections page and the Amazon secrets on Settings, Amazon (see below). Recreate the service with `docker compose -f deploy/docker-compose.yml up -d seller-hub`. |
| `SELLER_HUB_INTERNAL_SECRET` | backend and seller-hub | Shared secret authenticating calls between the two services | `openssl rand -hex 32` | Calls between backend and seller-hub fail until both run the new value. It is one variable feeding both, so change it once in `deploy/.env` and recreate both services together (`docker compose -f deploy/docker-compose.yml up -d backend seller-hub`). |
| `MEDUSA_ADMIN_PASSWORD` | seller-hub (account lives in backend) | Password of the Medusa admin user seller-hub signs in as (a secret, 32-character minimum) | `openssl rand -hex 32` | seller-hub cannot sign in to the backend until the admin user's password and this value match again. |
| `MEILISEARCH_API_KEY` | backend and meilisearch (backend-only: never in the storefront or any `NEXT_PUBLIC_` variable) | Meilisearch master key. The container starts with it as `MEILI_MASTER_KEY`; the backend uses it to index and search products. Required: check-env treats it as a secret (32-character minimum) and the backend refuses to start without it | `openssl rand -hex 32` | Recreate both together so they hold the same key: `docker compose -f deploy/docker-compose.yml up -d meilisearch backend`. Until both match, product search answers "Search is temporarily unavailable." (browsing and checkout keep working). The index data is kept. |
| `EASYPOST_API_KEY` | backend | EasyPost account API key | Issued by EasyPost (dashboard) | Shipping rates and labels fail until the new key is set. Recreate the service with `docker compose -f deploy/docker-compose.yml up -d backend`. |
| `EASYPOST_WEBHOOK_SECRET` | backend | Verifies EasyPost webhook signatures | Chosen by you, then set in the EasyPost webhook settings: `openssl rand -hex 32` | EasyPost webhooks are rejected until EasyPost and `deploy/.env` hold the same value. |
| `POSTGRES_PASSWORD` | postgres | Password of the Postgres superuser (`POSTGRES_USER`) | `openssl rand -hex 32` | Only read when the data directory is first created. Rotating later needs `ALTER ROLE` inside Postgres as well as the `.env` change; backups use it. |
| `MEDUSA_DB_PASSWORD` | postgres, backend, migrate | Password of the `medusa` role (owns the `public` schema) | `openssl rand -hex 32` | Set into the role on first start only. Rotate with `ALTER ROLE medusa PASSWORD ...` in Postgres and the `.env` change, then recreate backend with `docker compose -f deploy/docker-compose.yml up -d backend`. |
| `SELLER_HUB_DB_PASSWORD` | postgres, seller-hub | Password of the `seller_hub` role (owns the `seller_hub` schema) | `openssl rand -hex 32` | Same as above for the `seller_hub` role; recreate seller-hub with `docker compose -f deploy/docker-compose.yml up -d seller-hub`. |
| `REDIS_PASSWORD` | redis, backend, seller-hub | Redis `requirepass` | `openssl rand -hex 32` | Redis, backend and seller-hub must all be recreated with the new value (`docker compose -f deploy/docker-compose.yml up -d redis backend seller-hub`). Queued jobs are kept (append-only file). |
| `AMAZON_LWA_CLIENT_SECRET` | seller-hub | Amazon Login with Amazon client secret | Issued by Amazon (seller developer console) | Optional env fallback. Normally stored encrypted in seller-hub (Settings, Amazon) and the stored value wins. Rotate on that page; it applies without a restart. |
| `AMAZON_LWA_CLIENT_ID` | seller-hub | Amazon LWA client id (an identifier, kept private with the rest) | Issued by Amazon | Same as above. |
| `SQS_QUEUE_URL` | seller-hub | URL of the Amazon notification queue | Created in AWS | Same as above (optional env fallback; normally entered on Settings, Amazon). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | seller-hub | Access to the SQS queue (`AWS_REGION` is configuration, not a secret) | Created in AWS IAM, least privilege for the one queue: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` (or use an instance role and leave empty) | Same as above: normally stored encrypted in seller-hub and rotated on Settings, Amazon. If you rely on the env fallback instead, update `deploy/.env` and recreate seller-hub with `docker compose -f deploy/docker-compose.yml up -d seller-hub`. |
| `NEXT_PUBLIC_STORE_NAME` | storefront | Store name shown in the header, footer, menu and page titles | Your choice | Optional and not a secret: it is public by design and baked into the storefront bundle. Defaults to "Store" when unset. After changing it, rebuild: `docker compose -f deploy/docker-compose.yml build storefront`. |
| `NEXT_PUBLIC_NEWSLETTER_ACTION_URL` | storefront | https form action of your email provider for the homepage newsletter signup | Your email provider (Mailchimp, Klaviyo, etc.) | Optional and not a secret: it is public by design and baked into the storefront bundle. The newsletter section is hidden when empty or not https. After changing it, rebuild: `docker compose -f deploy/docker-compose.yml build storefront`. |
| `NEXT_PUBLIC_STRIPE_KEY` | storefront | Stripe publishable key | Stripe dashboard | Not a secret: it is public by design and baked into the storefront bundle. After changing it, rebuild: `docker compose -f deploy/docker-compose.yml build storefront`. The backend is not configured with a Stripe secret key in this stack; add a row here if that changes. |

A plain `docker compose restart` does not re-read `deploy/.env`. After any change to it, recreate the service with `docker compose -f deploy/docker-compose.yml up -d <service>`.

## Rotating `ENCRYPTION_KEY`

1. Note which marketplaces are connected (admin Marketplace connections page) and have each credential to hand from its marketplace.
2. Generate a new key with `openssl rand -hex 32` and put it in `deploy/.env`.
3. Recreate seller-hub so it re-reads `.env` (a plain restart does not): `docker compose -f deploy/docker-compose.yml up -d seller-hub`.
4. Open the admin Marketplace connections page and re-enter the credentials for every connection. Old ciphertext cannot be read with the new key, so connections stay broken until you do.
5. Open Settings, Amazon and re-enter the AWS access key id, AWS secret access key and LWA client secret (or press "Clear stored settings" first, then re-enter). After rotation these three stored secrets can no longer be decrypted, so they resolve as "not set" and silently fall back to the environment values or the default AWS credential chain until you re-enter them.

## Rotating `SELLER_HUB_INTERNAL_SECRET`

1. Generate a new value and put it in `deploy/.env` (one variable, used by both services).
2. Recreate both together so they re-read `.env` (a plain restart does not): `docker compose -f deploy/docker-compose.yml up -d backend seller-hub`.
3. Confirm `/health` on both (see the runbook).

## How check-env protects you

Each Node service starts with `node deploy/check-env.mjs <service> && exec <start command>`. The check reads `deploy/required-env.json` and, in production, refuses to start (non-zero exit, the container stops) when:

- a required variable is missing or empty;
- a value contains placeholder text such as `change-me`, `changeme`, `supersecret` or `your-`;
- a variable listed as a secret is shorter than 32 characters.

Problems are reported by variable name only; values are never printed. Outside production it only warns. Compose also refuses to start when a required variable is unset (`${VAR:?message}`).

## Never commit .env

`deploy/.env` holds real secrets and is git-ignored. Never commit it, paste it into an issue or chat, or put it in an image build argument. `deploy/.env.example` holds names only. If a real value was ever committed or shared, treat it as leaked and rotate it using the table above. Back up `deploy/.env` separately and securely: losing `ENCRYPTION_KEY` makes stored marketplace credentials unrecoverable even with a database backup.
