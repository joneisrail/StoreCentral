import { expect, test } from "vitest"
import type { ChannelListing } from "../sync/channel-import.js"
import { shapeImportOutcome, shapeImportPreview } from "./import-response.js"

const listing = (sku: string): ChannelListing => ({
  externalId: `e-${sku}`,
  parentExternalId: null,
  sku,
  title: `T ${sku}`,
  parentTitle: null,
  price: "9.99",
  stock: 4,
  imageUrl: "http://img/" + sku,
  currency: "USD",
})

test("preview reduces matched to sku/title and caps each group at 200 with totals", () => {
  const many = Array.from({ length: 250 }, (_, i) => listing(`S${i}`))
  const r = shapeImportPreview({
    matched: many,
    unmatched: many,
    duplicates: many.map((l) => l.sku!),
    noSku: many,
  })
  expect(r.matched).toHaveLength(200)
  expect(r.matched[0]).toEqual({ sku: "S0", title: "T S0" })
  expect(r.unmatched[0]).toEqual({
    sku: "S0",
    title: "T S0",
    price: "9.99",
    stock: 4,
    image_url: "http://img/S0",
  })
  expect(r.unmatched).toHaveLength(200)
  expect(r.duplicates).toHaveLength(200)
  expect(r.no_sku).toHaveLength(200)
  expect(r).toMatchObject({
    matched_total: 250,
    unmatched_total: 250,
    duplicates_total: 250,
    no_sku_total: 250,
  })
})

test("outcome caps lists at 100 and reports counts", () => {
  const n = (k: number) => Array.from({ length: k }, (_, i) => `S${i}`)
  const r = shapeImportOutcome({
    imported: n(3),
    failed: n(120).map((sku) => ({ sku, message: "m" })),
    skipped: [
      ...n(2).map((sku) => ({ sku, reason: "already_linked" as const })),
      { sku: "x", reason: "matched" as const },
      { sku: "y", reason: "currency" as const },
      ...n(100).map((sku) => ({ sku: "z" + sku, reason: "matched" as const })),
    ],
    deferred: n(130),
  })
  expect(r.imported).toEqual(["S0", "S1", "S2"])
  expect(r.failed).toHaveLength(100)
  expect(r.failed_total).toBe(120)
  expect(r.skipped_counts).toEqual({ already_linked: 2, matched: 101, currency: 1 })
  expect(r.skipped).toHaveLength(100)
  expect(r.skipped_total).toBe(104)
  expect(r.deferred).toHaveLength(100)
  expect(r.deferred_total).toBe(130)
})

test("caps are exact at the boundary", () => {
  const rows = (k: number) => Array.from({ length: k }, (_, i) => listing(`S${i}`))
  const preview = (k: number) =>
    shapeImportPreview({
      matched: rows(k),
      unmatched: rows(k),
      duplicates: rows(k).map((l) => l.sku!),
      noSku: rows(k),
    })
  for (const [k, shown] of [[200, 200], [201, 200]] as const) {
    const r = preview(k)
    expect([r.matched, r.unmatched, r.duplicates, r.no_sku].map((g) => g.length)).toEqual([shown, shown, shown, shown])
    expect(r.unmatched_total).toBe(k)
  }
  const outcome = (k: number) => {
    const n = Array.from({ length: k }, (_, i) => `S${i}`)
    return shapeImportOutcome({
      imported: [],
      failed: n.map((sku) => ({ sku, message: "m" })),
      skipped: n.map((sku) => ({ sku, reason: "matched" as const })),
      deferred: n,
    })
  }
  for (const [k, shown] of [[100, 100], [101, 100]] as const) {
    const r = outcome(k)
    expect([r.failed.length, r.skipped.length, r.deferred.length]).toEqual([shown, shown, shown])
    expect([r.failed_total, r.skipped_total, r.deferred_total]).toEqual([k, k, k])
  }
})
