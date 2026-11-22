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
| `JWT_SECRET` | backend | Signs admin and customer API tokens | `openssl rand -hex 32` | All signed-in sessions end; users sign in again. Restart backend. |
| `COOKIE_SECRET` | backend | Signs session cookies | `openssl rand -hex 32` | All sessions end; users sign in again. Restart backend. |
| `AUTH_MFA_ENCRYPTION_KEY` | backend | Encrypts stored multi-factor secrets | `openssl rand -hex 32` | Enrolled MFA secrets become unreadable; affected users must re-enrol. Leave it unchanged unless it leaked. |
| `ENCRYPTION_KEY` | seller-hub | Encrypts marketplace credentials stored in the database (64 hex characters) | `openssl rand -hex 32` | Stored marketplace credentials become unreadable. After rotating, re-enter every marketplace credential on the admin Marketplace connections page (see below). |
| `SELLER_HUB_INTERNAL_SECRET` | backend and seller-hub | Shared secret authenticating calls between the two services | `openssl rand -hex 32` | Calls between backend and seller-hub fail until both run the new value. It is one variable feeding both, so change it once in `deploy/.env` and restart both services together. |
| `MEDUSA_ADMIN_PASSWORD` | seller-hub (account lives in backend) | Password of the Medusa admin user seller-hub signs in as | `openssl rand -hex 32` | seller-hub cannot sign in to the backend until the admin user's password and this value match again. |
| `EASYPOST_API_KEY` | backend | EasyPost account API key | Issued by EasyPost (dashboard) | Shipping rates and labels fail until the new key is set. Restart backend. |
| `EASYPOST_WEBHOOK_SECRET` | backend | Verifies EasyPost webhook signatures | Chosen by you, then set in the EasyPost webhook settings: `openssl rand -hex 32` | EasyPost webhooks are rejected until EasyPost and `deploy/.env` hold the same value. |
| `POSTGRES_PASSWORD` | postgres | Password of the Postgres superuser (`POSTGRES_USER`) | `openssl rand -hex 32` | Only read when the data directory is first created. Rotating later needs `ALTER ROLE` inside Postgres as well as the `.env` change; backups use it. |
| `MEDUSA_DB_PASSWORD` | postgres, backend, migrate | Password of the `medusa` role (owns the `public` schema) | `openssl rand -hex 32` | Set into the role on first start only. Rotate with `ALTER ROLE medusa PASSWORD ...` in Postgres and the `.env` change, then restart backend. |
| `SELLER_HUB_DB_PASSWORD` | postgres, seller-hub | Password of the `seller_hub` role (owns the `seller_hub` schema) | `openssl rand -hex 32` | Same as above for the `seller_hub` role; restart seller-hub. |
| `REDIS_PASSWORD` | redis, backend, seller-hub | Redis `requirepass` | `openssl rand -hex 32` | Redis, backend and seller-hub must all restart with the new value. Queued jobs are kept (append-only file). |
| `AMAZON_LWA_CLIENT_SECRET` | seller-hub | Amazon Login with Amazon client secret | Issued by Amazon (seller developer console) | Amazon calls fail until the new secret is set. Restart seller-hub. |
| `AMAZON_LWA_CLIENT_ID` | seller-hub | Amazon LWA client id (an identifier, kept private with the rest) | Issued by Amazon | Same as above. |
| `SQS_QUEUE_URL` | seller-hub | URL of the Amazon notification queue | Created in AWS | Notifications stop until the new URL is set. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | seller-hub | Access to the SQS queue (`AWS_REGION` is configuration, not a secret) | Created in AWS IAM, least privilege for the one queue (or use an instance role and leave empty) | Optional in compose (empty by default). Until set, the SQS poll logs `CredentialsProviderError`, which is harmless. Rotating them: update `deploy/.env`, restart seller-hub. |
| `NEXT_PUBLIC_STRIPE_KEY` | storefront | Stripe publishable key | Stripe dashboard | Not a secret: it is public by design and baked into the storefront bundle. After changing it, rebuild: `docker compose -f deploy/docker-compose.yml build storefront`. The backend is not configured with a Stripe secret key in this stack; add a row here if that changes. |

## Rotating `ENCRYPTION_KEY`

1. Note which marketplaces are connected (admin Marketplace connections page) and have each credential to hand from its marketplace.
2. Generate a new key with `openssl rand -hex 32` and put it in `deploy/.env`.
3. Restart seller-hub: `docker compose -f deploy/docker-compose.yml up -d seller-hub`.
4. Open the admin Marketplace connections page and re-enter the credentials for every connection. Old ciphertext cannot be read with the new key, so connections stay broken until you do.

## Rotating `SELLER_HUB_INTERNAL_SECRET`

1. Generate a new value and put it in `deploy/.env` (one variable, used by both services).
2. Restart both together: `docker compose -f deploy/docker-compose.yml up -d backend seller-hub`.
3. Confirm `/health` on both (see the runbook).

## How check-env protects you

Each Node service starts with `node deploy/check-env.mjs <service> && exec <start command>`. The check reads `deploy/required-env.json` and, in production, refuses to start (non-zero exit, the container stops) when:

- a required variable is missing or empty;
- a value contains placeholder text such as `change-me`, `changeme`, `supersecret` or `your-`;
- a variable listed as a secret is shorter than 32 characters.

Problems are reported by variable name only; values are never printed. Outside production it only warns. Compose also refuses to start when a required variable is unset (`${VAR:?message}`).

## Never commit .env

`deploy/.env` holds real secrets and is git-ignored. Never commit it, paste it into an issue or chat, or put it in an image build argument. `deploy/.env.example` holds names only. If a real value was ever committed or shared, treat it as leaked and rotate it using the table above. Back up `deploy/.env` separately and securely: losing `ENCRYPTION_KEY` makes stored marketplace credentials unrecoverable even with a database backup.
