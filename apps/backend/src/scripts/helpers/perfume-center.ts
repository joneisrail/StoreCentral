/**
 * Pure helpers for importing the Perfume Center price list. No Medusa imports,
 * so they can be unit-tested without a container.
 */
import { parse } from 'csv-parse/sync'

export const SUPPLIER_NAME = 'Perfume Center'
export const SOURCE_LABEL = 'perfume-center-price-list-05-11-2026'

/**
 * Departments that are fragrances proper. Testers (WTST, MTST), oils, minis,
 * body care, aftershave and cosmetics are left out on purpose.
 */
export const FRAGRANCE_DEPTS = new Set([
  'M',
  'W',
  'XM',
  'XW',
  'SM',
  'SW',
  'UNI',
  'MDED',
  'WDED',
])

/** Supplier cost is marked up by this much to get the selling price. */
export const MARKUP_PERCENT = 30

export type SheetRow = {
  dept: string
  designer: string
  upc: string
  coo: string
  item: string
  description: string
  price: string
  salePrice: string
  imageUrl: string
}

export type SkipReason =
  | 'department'
  | 'bad-item'
  | 'duplicate-item'
  | 'no-description'
  | 'bad-price'

export type PlannedProduct = {
  item: string
  sku: string
  title: string
  handle: string
  brand: string | null
  costCents: number
  priceCents: number
  barcode: string | null
  upc: string | null
  gender: string | null
  dept: string
  countryOfOrigin: string | null
  imageUrl: string | null
}

export type Plan = {
  products: PlannedProduct[]
  skipped: { item: string; reason: SkipReason }[]
}

const clean = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** The sheet is a Windows-1252 CSV export with a repeated Hyperlink column. */
export function parseSheet(buffer: Buffer): SheetRow[] {
  const text = new TextDecoder('windows-1252').decode(buffer)
  const records: string[][] = parse(text, {
    relax_column_count: true,
    skip_empty_lines: true,
  })
  const [header, ...rows] = records
  const index = new Map<string, number>()

  header.forEach((name, position) => {
    index.set(clean(name).toLowerCase(), position)
  })

  const at = (row: string[], name: string) =>
    clean(row[index.get(name) ?? -1])

  return rows
    .filter((row) => row.some((cell) => clean(cell)))
    .map((row) => ({
      dept: at(row, 'dept'),
      designer: at(row, 'designer'),
      upc: at(row, 'upc'),
      coo: at(row, 'coo'),
      item: at(row, 'item'),
      description: at(row, 'description'),
      price: at(row, 'price'),
      salePrice: at(row, 'saleprice'),
      // The last column holds the picture link; the one before it repeats the item.
      imageUrl: clean(row[row.length - 1]),
    }))
}

/** Our own number: the supplier item with a leading "A". */
export const toSku = (item: string) => `A${item}`

export function toCents(value: string): number | null {
  const parsed = Number(value.replace(/[$,\s]/g, ''))

  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

/** Cost plus the markup, rounded up to the next 50 cents. Integer maths only. */
export function sellingPriceCents(costCents: number, markup = MARKUP_PERCENT) {
  return Math.ceil((costCents * (100 + markup)) / 5000) * 50
}

export function slugify(text: string) {
  return clean(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
}

/** (M), (W) and (U) in the supplier's descriptions mark who a scent is for. */
export function genderFromDescription(description: string) {
  const marker = /\((M|W|U)\)/i.exec(description)?.[1]?.toUpperCase()

  if (marker === 'M') return 'Men'
  if (marker === 'W') return 'Women'
  if (marker === 'U') return 'Unisex'

  return null
}

/** Real barcodes are 8 to 14 digits; the sheet sometimes repeats the item id. */
export const barcodeFrom = (upc: string) =>
  /^\d{8,14}$/.test(upc) ? upc : null

export function planProducts(rows: SheetRow[]): Plan {
  const skipped: Plan['skipped'] = []
  const seenItems = new Set<string>()
  const seenBarcodes = new Set<string>()
  const products: PlannedProduct[] = []

  for (const row of rows) {
    const fail = (reason: SkipReason) =>
      skipped.push({ item: row.item || '(blank)', reason })

    if (!FRAGRANCE_DEPTS.has(row.dept)) {
      fail('department')
      continue
    }
    if (!/^I\d{7}$/.test(row.item)) {
      fail('bad-item')
      continue
    }
    if (seenItems.has(row.item)) {
      fail('duplicate-item')
      continue
    }
    if (!row.description) {
      fail('no-description')
      continue
    }

    const costCents = toCents(row.price)

    if (costCents === null || costCents <= 0) {
      fail('bad-price')
      continue
    }

    seenItems.add(row.item)

    const barcode = barcodeFrom(row.upc)
    // A barcode may belong to one variant only; repeats keep it as metadata.
    const usableBarcode = barcode && !seenBarcodes.has(barcode) ? barcode : null

    if (usableBarcode) {
      seenBarcodes.add(usableBarcode)
    }

    const sku = toSku(row.item)

    products.push({
      item: row.item,
      sku,
      title: row.description,
      handle: `${slugify(row.description)}-${sku.toLowerCase()}`,
      brand: row.designer || null,
      costCents,
      priceCents: sellingPriceCents(costCents),
      barcode: usableBarcode,
      upc: barcode,
      gender: genderFromDescription(row.description),
      dept: row.dept,
      countryOfOrigin: row.coo || null,
      imageUrl: /^https?:\/\//.test(row.imageUrl) ? row.imageUrl : null,
    })
  }

  return { products, skipped }
}

/**
 * One handle per brand name. Two names that slug the same (or collide with a
 * handle already in use) get a numeric suffix so no category is lost.
 */
export function brandHandles(brands: string[], reserved: Iterable<string>) {
  const used = new Set(reserved)
  const handles = new Map<string, string>()

  for (const brand of [...new Set(brands)].sort()) {
    const base = slugify(brand) || 'brand'
    let handle = base
    let n = 2

    while (used.has(handle)) {
      handle = `${base}-${n}`
      n += 1
    }

    used.add(handle)
    handles.set(brand, handle)
  }

  return handles
}

export const dollars = (cents: number) => cents / 100

/**
 * The DEPT column is the shop category. M and W are Men and Women; the rest are
 * the sheet's sets, deodorant and body mist departments. Departments that are
 * not listed here get no department category.
 */
export const DEPT_CATEGORIES: Record<string, { name: string; handle: string }> = {
  M: { name: 'Men', handle: 'men' },
  W: { name: 'Women', handle: 'women' },
  UNI: { name: 'Unisex', handle: 'unisex' },
  SM: { name: "Men's Sets", handle: 'mens-sets' },
  SW: { name: "Women's Sets", handle: 'womens-sets' },
  MDED: { name: "Men's Deodorants & Body Sprays", handle: 'mens-deodorants-body-sprays' },
  WDED: { name: "Women's Body Mists", handle: 'womens-body-mists' },
}
