import type { Queue } from "bullmq"

export type ChannelPushKind = "stock" | "price" | "both"

export type ChannelPushJobData = {
  variantId: string
  salesChannelId: string
  kind: ChannelPushKind
  force: boolean
}

export const CHANNEL_PUSH_JOB_NAME = "channel-offer.changed"

/** BullMQ rejects integer-only custom ids, hence the prefix. */
export const channelPushJobId = (variantId: string, salesChannelId: string): string =>
  `channel-${variantId}-${salesChannelId}`

/** The union of two kinds (stock + price => both). */
export const widenKind = (a: ChannelPushKind, b: ChannelPushKind): ChannelPushKind => {
  if (a === b) return a
  return "both"
}

/**
 * Applies the price rule: a price part is only pushed when forced (sync icon)
 * or when the connection auto-syncs prices. null = nothing left to push.
 */
export const decideKind = (
  kind: ChannelPushKind,
  force: boolean,
  autoSyncPrice: boolean
): ChannelPushKind | null => {
  if (force || autoSyncPrice || kind === "stock") return kind
  return kind === "both" ? "stock" : null
}

const WAITING_STATES = new Set(["waiting", "delayed", "prioritized", "waiting-children"])

/**
 * Enqueues one push per (variant, channel). A still-waiting job with the same
 * id is merged (kind widened to the union, force OR-ed) instead of duplicated;
 * otherwise a fresh job is added (BullMQ itself ignores an id that is active).
 */
export const enqueueChannelPush = async (
  queue: Queue,
  data: ChannelPushJobData
): Promise<void> => {
  const jobId = channelPushJobId(data.variantId, data.salesChannelId)
  const existing = await queue.getJob(jobId)
  if (existing && WAITING_STATES.has(await existing.getState())) {
    const current = existing.data as ChannelPushJobData
    const kind = widenKind(current.kind, data.kind)
    const force = current.force || data.force
    if (kind !== current.kind || force !== current.force) {
      await existing.updateData({ ...current, kind, force })
    }
    return
  }
  await queue.add(CHANNEL_PUSH_JOB_NAME, data, {
    jobId,
    removeOnComplete: true,
    removeOnFail: true,
  })
}
