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

/** Merges `data` into a waiting job; false when it cannot be merged (not waiting, or it was picked up meanwhile). */
const tryMerge = async (
  queue: Queue,
  jobId: string,
  data: ChannelPushJobData
): Promise<"merged" | "absent" | "busy"> => {
  const existing = await queue.getJob(jobId)
  if (!existing) return "absent"
  try {
    if (!WAITING_STATES.has(await existing.getState())) return "busy"
    const current = existing.data as ChannelPushJobData
    const kind = widenKind(current.kind, data.kind)
    const force = current.force || data.force
    if (kind !== current.kind || force !== current.force) {
      await existing.updateData({ ...current, kind, force })
    }
    return "merged"
  } catch {
    // The worker took the job between the state read and the update.
    return "busy"
  }
}

const addJob = (queue: Queue, jobId: string, data: ChannelPushJobData) =>
  queue.add(CHANNEL_PUSH_JOB_NAME, data, {
    jobId,
    removeOnComplete: true,
    removeOnFail: true,
  })

/**
 * Puts the change into the job `jobId`: merges into a waiting job, or adds it
 * and then re-reads the job. Two concurrent webhooks can both see "absent" and
 * both add the same id; BullMQ keeps only the first, so the second change
 * would be lost. The re-read merges it into whatever job now holds the id.
 * false when the id is held by a job that cannot take the change.
 */
const place = async (queue: Queue, jobId: string, data: ChannelPushJobData): Promise<boolean> => {
  const state = await tryMerge(queue, jobId, data)
  if (state === "merged") return true
  if (state === "busy") return false
  await addJob(queue, jobId, data)
  // "absent" again means the job already ran and was removed: nothing to merge.
  return (await tryMerge(queue, jobId, data)) !== "busy"
}

/**
 * Enqueues one push per (variant, channel). A still-waiting job with the same
 * id is merged (kind widened to the union, force OR-ed). BullMQ silently drops
 * an add whose id is active, and the running job already read its values, so a
 * non-mergeable (active) base job sends the change to a follow-up job
 * `<id>-next` (merged the same way). If that one is busy too, a uniquely
 * suffixed job is added. The worker runs one job at a time (BullMQ concurrency
 * 1 in createSyncWorker), so a follow-up always runs after the base job.
 */
export const enqueueChannelPush = async (
  queue: Queue,
  data: ChannelPushJobData
): Promise<void> => {
  const baseId = channelPushJobId(data.variantId, data.salesChannelId)
  if (await place(queue, baseId, data)) return
  const nextId = `${baseId}-next`
  if (await place(queue, nextId, data)) return
  await addJob(queue, `${nextId}-${Date.now()}`, data)
}
