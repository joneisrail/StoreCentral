import type { ImportOutcome, ImportPreview } from "../sync/channel-import-run.js"
import type { ChannelListing } from "../sync/channel-import.js"

const PREVIEW_ROW_CAP = 200
const OUTCOME_LIST_CAP = 100

const titleOf = (l: ChannelListing): string =>
  l.title && l.parentTitle && l.parentTitle !== l.title
    ? `${l.parentTitle} - ${l.title}`
    : l.title || l.parentTitle || (l.sku ?? "")

/** Bounds the preview body: first 200 rows per group plus the full counts. */
export const shapeImportPreview = (plan: ImportPreview) => {
  const full = (l: ChannelListing) => ({
    sku: (l.sku ?? "").trim(),
    title: titleOf(l),
    price: l.price,
    stock: l.stock,
    image_url: l.imageUrl,
  })
  return {
    matched: plan.matched
      .slice(0, PREVIEW_ROW_CAP)
      .map((l) => ({ sku: (l.sku ?? "").trim(), title: titleOf(l) })),
    unmatched: plan.unmatched.slice(0, PREVIEW_ROW_CAP).map(full),
    duplicates: plan.duplicates.slice(0, PREVIEW_ROW_CAP),
    no_sku: plan.noSku.slice(0, PREVIEW_ROW_CAP).map(full),
    matched_total: plan.matched.length,
    unmatched_total: plan.unmatched.length,
    duplicates_total: plan.duplicates.length,
    no_sku_total: plan.noSku.length,
  }
}

/** Bounds the import body: counts for everything, first 100 entries per list. */
export const shapeImportOutcome = (outcome: ImportOutcome) => {
  const skipped_counts = { already_linked: 0, matched: 0, currency: 0 }
  for (const s of outcome.skipped) skipped_counts[s.reason] += 1
  return {
    imported: outcome.imported,
    failed: outcome.failed.slice(0, OUTCOME_LIST_CAP),
    failed_total: outcome.failed.length,
    skipped_counts,
    skipped: outcome.skipped.slice(0, OUTCOME_LIST_CAP),
    skipped_total: outcome.skipped.length,
    deferred: outcome.deferred.slice(0, OUTCOME_LIST_CAP),
    deferred_total: outcome.deferred.length,
  }
}
