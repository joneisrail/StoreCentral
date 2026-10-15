import type { Pool } from "pg"
import type { Queue } from "bullmq"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { SpApiClient } from "../sp-api/client.js"
import { pushInventoryUpdate } from "./push-inventory.js"
import { reconcile } from "./reconcile.js"
import {
  resolveInventoryChannelListingId,
  type InventorySyncJobData,
} from "./resolve-channel-listing.js"

export type InventorySyncProcessorDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  spApiClient: SpApiClient
  integrationAccountId: string
  inventoryQueue: Queue
  priceQueue: Queue
}

/**
 * Processes one `inventory-sync` BullMQ job's data, dispatching on its
 * *shape* rather than its job name.
 *
 * This queue carries jobs from three producers, and two of them use the
 * exact same job name, `"reconcile"`:
 * - `scheduleReconciliation` (Task 11, wired in `index.ts`) adds an
 *   empty-payload `"reconcile"` job on a repeat schedule -- the scan
 *   trigger that calls `reconcile()` itself.
 * - `reconcile()` (Task 11) adds its own *corrective* job back onto this
 *   same queue when it finds drift -- also named `"reconcile"`
 *   (`inventoryQueue.add("reconcile", { channelListingId })`), but carrying
 *   a `channelListingId` to push.
 * - the webhook flow (Task 9) adds a job carrying `{ inventoryLevelId }`
 *   under the raw Medusa event name (e.g. `"inventory-level.updated"`).
 *
 * Dispatching on `job.name === "reconcile"` can't tell the scan trigger
 * apart from reconcile's own corrective job -- both are named "reconcile".
 * Routing the corrective job into another full `reconcile()` scan instead
 * of pushing it would silently discard its `channelListingId`, report
 * BullMQ success despite nothing being pushed to Amazon, and (since the
 * drift is never actually fixed) have the very next scan re-enqueue the
 * same corrective job again -- an unbounded, self-perpetuating loop as soon
 * as any listing drifts, which is the steady state reconciliation exists
 * for. Dispatching on whether the job's data is empty, instead of its name,
 * avoids that: only the true empty-payload scan trigger takes the
 * `reconcile()` path, and a `channelListingId`-or-`inventoryLevelId` job
 * always resolves-and-pushes, regardless of what it's named.
 */
export const processInventorySyncJob = async (
  data: InventorySyncJobData | Record<string, never>,
  deps: InventorySyncProcessorDeps
): Promise<void> => {
  const isScanTrigger =
    !("channelListingId" in data) && !("inventoryLevelId" in data)

  if (isScanTrigger) {
    await reconcile({
      pool: deps.pool,
      medusaClient: deps.medusaClient,
      integrationAccountId: deps.integrationAccountId,
      inventoryQueue: deps.inventoryQueue,
      priceQueue: deps.priceQueue,
    })
    return
  }

  const channelListingId = await resolveInventoryChannelListingId(
    data as InventorySyncJobData,
    {
      pool: deps.pool,
      medusaClient: deps.medusaClient,
      integrationAccountId: deps.integrationAccountId,
    }
  )
  await pushInventoryUpdate({
    pool: deps.pool,
    medusaClient: deps.medusaClient,
    spApiClient: deps.spApiClient,
    integrationAccountId: deps.integrationAccountId,
    channelListingId,
  })
}
