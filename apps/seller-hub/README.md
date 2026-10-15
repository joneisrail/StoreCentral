# @dtc/seller-hub

Seller Hub's Amazon sync engine: a standalone Node service that keeps this
project's Medusa backend and an Amazon Seller Central account in sync —
importing Amazon orders into Medusa, pushing Medusa's inventory/price/product
changes out to Amazon, and periodically reconciling the two so a missed
webhook or notification doesn't cause permanent drift. See
[`docs/superpowers/specs/2026-10-15-seller-hub-amazon-sync-design.md`](../../docs/superpowers/specs/2026-10-15-seller-hub-amazon-sync-design.md)
for the full design (architecture, decisions, and the implementation plan's
task breakdown it was built from).

## Running locally

1. Copy `.env.example` to `.env` and fill in the values:

   | Variable | Purpose |
   | --- | --- |
   | `DATABASE_URL` | Postgres connection string (same instance/database as the Medusa backend; this service owns its own `seller_hub` schema within it) |
   | `REDIS_URL` | Redis connection used by the BullMQ job queues |
   | `MEDUSA_BACKEND_URL` | Base URL of the Medusa backend, no trailing slash |
   | `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD` | Medusa admin user this service authenticates as |
   | `ENCRYPTION_KEY` | 32-byte hex key used to encrypt the stored Amazon LWA refresh token |
   | `AWS_REGION` | AWS region for the SQS queue |
   | `SQS_QUEUE_URL` | SQS queue that receives Amazon's SP-API order-change notifications |
   | `AMAZON_LWA_CLIENT_ID` / `AMAZON_LWA_CLIENT_SECRET` | Login-with-Amazon credentials for the SP-API application |

2. Make sure Postgres, Redis, and the Medusa backend are running, and that
   the Medusa backend's own `.env` has `SELLER_HUB_WEBHOOK_URL` pointing at
   this service's webhook port (`http://localhost:7005` by default — see
   `WEBHOOK_PORT` below).

3. Start the service:

   ```bash
   yarn workspace @dtc/seller-hub dev
   ```

   On boot it applies the `seller_hub` schema's migrations, starts the four
   BullMQ sync queues/workers (order, inventory, price, product), starts the
   webhook server that receives Medusa's inventory/price change events,
   starts the SQS consumer that polls for Amazon order-change notifications,
   and schedules hourly reconciliation.

   `WEBHOOK_PORT` (optional, defaults to `7005`) overrides the port the
   webhook server binds to, without widening `SellerHubEnv`'s required
   variables for a purely local bind-address concern.

## External prerequisites not yet in place

Two things from the design spec's Open Items are genuine external
prerequisites, outside this repo's control, and are **not** set up yet. Until
both are done, the service boots and stays up (see below), but every
Amazon-facing call fails against a placeholder/absent credential rather than
succeeding for real:

- **AWS account and SQS queue.** `SQS_QUEUE_URL` in `.env` is currently a
  placeholder. The SQS consumer logs `receiveMessage` failures against it on
  every poll — expected, and non-fatal, but it means no real Amazon order
  notification can arrive until a real SQS queue (subscribed to Amazon's
  `ORDER_CHANGE` notifications) exists and `SQS_QUEUE_URL`/`AWS_REGION` point
  at it.
- **Amazon SP-API app registration / professional seller account approval.**
  `AMAZON_LWA_CLIENT_ID`/`AMAZON_LWA_CLIENT_SECRET` are placeholders, and no
  Amazon refresh token has been connected yet (`seller_hub.integration_account`
  starts `disconnected`). This has its own external approval timeline and is
  worth starting early.

Both need to be resolved before Task 13's manual smoke checklist (an
end-to-end pass against Amazon's real sandbox/test seller account for order
import, inventory push, price push, and product listing) can run for real.
