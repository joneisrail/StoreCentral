/**
 * Replaces the store's products with the fragrances from the Perfume Center
 * price list.
 *
 *   npx medusa exec ./src/scripts/import-perfume-center.ts <sheet.csv> --dry-run
 *   npx medusa exec ./src/scripts/import-perfume-center.ts <sheet.csv>
 *
 * Dry run only reads the sheet and prints what would happen. A real run:
 *   1. deletes every existing product (and the inventory items and supplier
 *      products that belonged to them),
 *   2. creates the Perfume Center supplier,
 *   3. creates a "Brands" category with one child per brand,
 *   4. downloads each picture into the file module and creates one published
 *      product per row (SKU "A" + the supplier item, selling price = cost + 30%,
 *      inventory not tracked) in the storefront's sales channels,
 *   5. records the supplier SKU and cost for every variant.
 *
 * Re-running skips products whose handle already exists, so an interrupted run
 * can be resumed. Take a database backup first.
 */
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  deleteInventoryItemWorkflow,
  updateProductsWorkflow,
} from '@medusajs/medusa/core-flows'
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { readFileSync, writeFileSync } from 'fs'
import { CHANNEL_OFFERS_MODULE } from '../modules/channel-offers'
import type ChannelOffersModuleService from '../modules/channel-offers/service'
import { SUPPLIER_MODULE } from '../modules/supplier'
import type SupplierModuleService from '../modules/supplier/service'
import { readChannelIdsInCreationOrder } from '../workflows/steps/split-received-stock-across-channels'
import createSupplierWorkflow from '../workflows/create-supplier'
import createSupplierProductWorkflow from '../workflows/create-supplier-product'
import deleteSupplierProductWorkflow from '../workflows/delete-supplier-product'
import {
  SOURCE_LABEL,
  SUPPLIER_NAME,
  brandHandles,
  dollars,
  parseSheet,
  planProducts,
  type PlannedProduct,
} from './helpers/perfume-center'

const CHANNEL_NAMES = [
  'Default Sales Channel',
  'Point of Sale',
  'Mobile App',
  'Amazon',
  'aifragrance.com',
]
const BATCH_SIZE = 25
const IMAGE_CONCURRENCY = 6
const IMAGE_TIMEOUT_MS = 20000

type Report = {
  deletedProducts: string[]
  keptInventoryItems: string[]
  createdProducts: number
  skippedExisting: number
  supplierProducts: number
  imageFailures: { item: string; reason: string }[]
  imagesRepaired: number
  imageUnavailable: { item: string; reason: string }[]
  productFailures: { item: string; reason: string }[]
  supplierFailures: { item: string; reason: string }[]
}

const message = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const text = (error as { message?: unknown }).message
    const detail = typeof text === 'string' ? text : JSON.stringify(error)

    return detail.slice(0, 500)
  }

  return String(error)
}

async function inChunks<T, R>(
  items: T[],
  size: number,
  work: (chunk: T[], index: number) => Promise<R>
) {
  const results: R[] = []

  for (let i = 0; i < items.length; i += size) {
    results.push(await work(items.slice(i, i + size), i / size))
  }

  return results
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const current = next++
        results[current] = await work(items[current])
      }
    })
  )

  return results
}

/** The picture host is case sensitive about the extension: some items exist only as .JPG. */
function imageCandidates(url: string) {
  const base = url.replace(/.(jpe?g|png)$/i, '')

  return [url, `${base}.JPG`, `${base}.jpeg`, `${base}.png`, `${base}.PNG`].filter(
    (candidate, index, all) => all.indexOf(candidate) === index
  )
}

async function downloadOne(url: string) {
  let lastError = 'unknown'

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      })

      if (response.status === 404) {
        throw new Error('HTTP 404')
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const type = response.headers.get('content-type') ?? ''
      const bytes = Buffer.from(await response.arrayBuffer())

      if (!type.startsWith('image/') || bytes.length < 500) {
        throw new Error(`not an image (${type || 'no type'}, ${bytes.length} bytes)`)
      }

      return { bytes, type: type.split(';')[0] }
    } catch (error) {
      lastError = message(error)

      // A 404 will not change on retry; move on to the next extension.
      if (lastError === 'HTTP 404') {
        break
      }
    }
  }

  throw new Error(lastError)
}

async function download(url: string) {
  let lastError = 'unknown'

  for (const candidate of imageCandidates(url)) {
    try {
      return await downloadOne(candidate)
    } catch (error) {
      lastError = message(error)
    }
  }

  throw new Error(lastError)
}

export default async function importPerfumeCenter({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const dryRun = args.includes('--dry-run') || args.includes('dry-run')
  const limitArg = args.find((arg) => arg.startsWith('limit='))
  const limit = limitArg ? Number(limitArg.slice('limit='.length)) : undefined
  const sheetPath = args.find(
    (arg) => !arg.startsWith('--') && arg !== 'dry-run' && !arg.startsWith('limit=')
  )

  if (!sheetPath) {
    throw new Error('Pass the path to the price list CSV as the first argument.')
  }

  const rows = parseSheet(readFileSync(sheetPath))
  const planned = planProducts(rows)
  const skipped = planned.skipped
  // `limit=N` imports only the first N products, for a trial run. A later full
  // run keeps them (same handles) and adds the rest.
  const products = limit ? planned.products.slice(0, limit) : planned.products
  const allHandles = new Set(planned.products.map((p) => p.handle))
  const brands = [...new Set(products.map((p) => p.brand).filter((b): b is string => Boolean(b)))]
  const prices = products.map((p) => p.priceCents)

  const skippedByReason = skipped.reduce<Record<string, number>>((acc, s) => {
    acc[s.reason] = (acc[s.reason] ?? 0) + 1
    return acc
  }, {})

  logger.info(
    [
      `Sheet rows: ${rows.length}`,
      `Products to create: ${products.length}`,
      `Skipped: ${JSON.stringify(skippedByReason)}`,
      `Brands: ${brands.length} (rows without a brand: ${products.filter((p) => !p.brand).length})`,
      `With picture link: ${products.filter((p) => p.imageUrl).length}`,
      `With barcode: ${products.filter((p) => p.barcode).length}`,
      `Selling price range: $${dollars(Math.min(...prices))} to $${dollars(Math.max(...prices))}`,
      `Sample: ${products
        .slice(0, 3)
        .map((p) => `${p.sku} "${p.title}" cost $${dollars(p.costCents)} sell $${dollars(p.priceCents)}`)
        .join(' | ')}`,
    ].join('\n')
  )

  const { data: existing } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle'],
  })

  logger.info(`Existing products that would be deleted: ${existing.length}`)

  if (dryRun) {
    logger.info('Dry run: nothing was changed.')
    return
  }

  const report: Report = {
    deletedProducts: [],
    keptInventoryItems: [],
    createdProducts: 0,
    skippedExisting: 0,
    supplierProducts: 0,
    imageFailures: [],
    imagesRepaired: 0,
    imageUnavailable: [],
    productFailures: [],
    supplierFailures: [],
  }
  const reportPath = `C:/Users/jonei/StoreCentral-backups/perfume-import-report-${Date.now()}.json`
  const saveReport = () => writeFileSync(reportPath, JSON.stringify(report, null, 2))

  const { data: channels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
    filters: { name: CHANNEL_NAMES },
  })
  const missing = CHANNEL_NAMES.filter((name) => !channels.some((c) => c.name === name))

  if (missing.length) {
    throw new Error(`Sales channels not found: ${missing.join(', ')}`)
  }

  const supplierModule = container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
  const fileModule = container.resolve(Modules.FILE)
  const productModule = container.resolve(Modules.PRODUCT)
  const inventoryModule = container.resolve(Modules.INVENTORY)
  const eventBus = container.resolve(Modules.EVENT_BUS)
  const offersModule = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
  const channelIds = await readChannelIdsInCreationOrder(container)

  // 1. Remove what is there now.
  const oldProductIds = existing
    .filter((p) => !allHandles.has(p.handle))
    .map((p) => p.id)

  if (oldProductIds.length) {
    const { data: oldVariants } = await query.graph({
      entity: 'product_variant',
      fields: ['id', 'inventory_items.inventory_item_id'],
      filters: { product_id: oldProductIds },
    })
    const variantIds = oldVariants.map((v) => v.id)
    const inventoryItemIds = [
      ...new Set(
        oldVariants.flatMap((v) =>
          (v.inventory_items ?? []).map((link) => link?.inventory_item_id as string)
        )
      ),
    ].filter(Boolean)
    const oldSupplierProducts = variantIds.length
      ? await supplierModule.listSupplierProducts({ variant_id: variantIds })
      : []

    for (const supplierProduct of oldSupplierProducts) {
      await deleteSupplierProductWorkflow(container).run({
        input: { id: supplierProduct.id, supplier_id: supplierProduct.supplier_id },
      })
    }

    // Inventory items that pending orders still reserve stock on cannot be
    // deleted (and the delete-products workflow would stop on them), so those
    // are left alone. They are listed in the report.
    const reserved = inventoryItemIds.length
      ? await inventoryModule.listReservationItems(
          { inventory_item_id: inventoryItemIds },
          { select: ['inventory_item_id'], take: null }
        )
      : []
    const reservedIds = new Set(reserved.map((r) => r.inventory_item_id))
    const deletableItemIds = inventoryItemIds.filter((id) => !reservedIds.has(id))

    if (deletableItemIds.length) {
      await deleteInventoryItemWorkflow(container).run({ input: deletableItemIds })
    }

    // Soft delete, as the delete-products workflow does, without its inventory
    // step. The local event bus has no workflow here, so product.deleted is
    // emitted by hand for the search index.
    await productModule.softDeleteProducts(oldProductIds)
    await eventBus.emit(
      oldProductIds.map((id) => ({ name: 'product.deleted', data: { id } }))
    )

    report.deletedProducts = oldProductIds
    report.keptInventoryItems = [...reservedIds] as string[]
    logger.info(
      `Deleted ${oldProductIds.length} products, ${deletableItemIds.length} inventory items, ${oldSupplierProducts.length} supplier products. Left ${reservedIds.size} inventory items that pending orders reserve.`
    )
  }

  // 2. Supplier.
  const suppliers = await supplierModule.listSuppliers({ name: SUPPLIER_NAME })
  let supplierId = suppliers[0]?.id

  if (!supplierId) {
    const { result } = await createSupplierWorkflow(container).run({
      input: { name: SUPPLIER_NAME, notes: `Price list ${SOURCE_LABEL}` },
    })
    supplierId = result.supplier.id
    logger.info(`Created supplier ${SUPPLIER_NAME}.`)
  }

  // 3. Brand categories.
  const { data: categories } = await query.graph({
    entity: 'product_category',
    fields: ['id', 'handle', 'name', 'parent_category_id'],
  })
  let brandsParentId: string | undefined = categories.find((c) => c.handle === 'brands')?.id

  if (!brandsParentId) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [{ name: 'Brands', handle: 'brands', is_active: true }],
      },
    })
    brandsParentId = result[0].id
  }

  const existingBrandCategories = new Map(
    categories
      .filter((c) => c.parent_category_id === brandsParentId as string)
      .map((c) => [c.name, c.id])
  )
  const handles = brandHandles(
    brands.filter((b) => !existingBrandCategories.has(b)),
    categories.map((c) => c.handle)
  )
  const newBrands = [...handles.entries()]

  await inChunks(newBrands, 100, async (chunk) => {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: chunk.map(([name, handle]) => ({
          name,
          handle,
          parent_category_id: brandsParentId as string,
          is_active: true,
        })),
      },
    })

    for (const category of result) {
      existingBrandCategories.set(category.name, category.id)
    }
  })
  logger.info(`Brand categories ready: ${existingBrandCategories.size}.`)

  // 4 and 5. Products in batches: pictures, product, supplier record.
  const { data: already } = await query.graph({
    entity: 'product',
    fields: ['handle'],
  })
  const haveHandles = new Set(already.map((p) => p.handle))
  const todo = products.filter((p) => {
    if (haveHandles.has(p.handle)) {
      report.skippedExisting += 1
      return false
    }
    return true
  })

  await inChunks(todo, BATCH_SIZE, async (batch, batchIndex) => {
    const pictures = new Map<string, string>()

    await mapLimit(batch.filter((p) => p.imageUrl), IMAGE_CONCURRENCY, async (p: PlannedProduct) => {
      try {
        const { bytes, type } = await download(p.imageUrl as string)
        const extension = type === 'image/png' ? 'png' : 'jpg'
        const file = await fileModule.createFiles({
          filename: `perfume-center/${p.sku}.${extension}`,
          mimeType: type,
          content: bytes.toString('base64'),
          access: 'public',
        })
        pictures.set(p.sku, file.url)
      } catch (error) {
        report.imageFailures.push({ item: p.item, reason: message(error) })
      }
    })

    const createGroup = async (batch: PlannedProduct[]) => {
      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: batch.map((p) => ({
            title: p.title,
            handle: p.handle,
            status: ProductStatus.PUBLISHED,
            thumbnail: pictures.get(p.sku),
            images: pictures.has(p.sku) ? [{ url: pictures.get(p.sku) as string }] : [],
            category_ids: p.brand && existingBrandCategories.has(p.brand)
              ? [existingBrandCategories.get(p.brand) as string]
              : [],
            sales_channels: channels.map((c) => ({ id: c.id })),
            options: [{ title: 'Title', values: ['Default'] }],
            metadata: {
              supplier: SUPPLIER_NAME,
              supplier_item: p.item,
              source: SOURCE_LABEL,
              dept: p.dept,
              ...(p.countryOfOrigin ? { country_of_origin: p.countryOfOrigin } : {}),
              ...(p.upc ? { upc: p.upc } : {}),
              ...(p.gender ? { gender: p.gender } : {}),
            },
            variants: [
              {
                title: 'Default',
                sku: p.sku,
                barcode: p.barcode ?? undefined,
                manage_inventory: false,
                allow_backorder: false,
                options: { Title: 'Default' },
                prices: [{ currency_code: 'usd', amount: dollars(p.priceCents) }],
              },
            ],
          })),
        },
      })

      report.createdProducts += result.length

      // The local event bus used by `medusa exec` has no subscribers, so the
      // channel offers the live subscriber would create are ensured here.
      const newVariantIds = result.flatMap((p) => (p.variants ?? []).map((v) => v.id))

      try {
        await offersModule.ensureOffers(newVariantIds, channelIds)
      } catch (error) {
        report.supplierFailures.push({ item: 'channel-offers', reason: message(error) })
      }

      for (const created of result) {
        const planned = batch.find((p) => p.handle === created.handle)
        const variant = created.variants?.[0]

        if (!planned || !variant) {
          continue
        }

        try {
          await createSupplierProductWorkflow(container).run({
            input: {
              supplier_id: supplierId as string,
              variant_id: variant.id,
              supplier_sku: planned.item,
              supplier_title: planned.title,
              unit_cost: dollars(planned.costCents),
            },
          })
          report.supplierProducts += 1
        } catch (error) {
          report.supplierFailures.push({ item: planned.item, reason: message(error) })
        }
      }
    }

    try {
      await createGroup(batch)
    } catch (batchError) {
      // One bad product fails its whole batch, so try them one at a time.
      logger.warn(`Batch failed (${message(batchError)}); retrying its products one by one.`)

      for (const p of batch) {
        try {
          await createGroup([p])
        } catch (error) {
          report.productFailures.push({ item: p.item, reason: message(error) })
        }
      }
    }

    saveReport()
    logger.info(
      `Batch ${batchIndex + 1}/${Math.ceil(todo.length / BATCH_SIZE)}: created ${report.createdProducts}, supplier records ${report.supplierProducts}, image failures ${report.imageFailures.length}, product failures ${report.productFailures.length}`
    )
  })

  // Repair pass over every planned product that already exists: a picture that
  // failed earlier, a supplier record or channel offers an interrupted run
  // never got to. Everything here is idempotent.
  await inChunks(products, 100, async (chunk) => {
    const { data: found } = await query.graph({
      entity: 'product',
      fields: ['id', 'handle', 'thumbnail', 'variants.id'],
      filters: { handle: chunk.map((p) => p.handle) },
    })
    const variantIds = found.flatMap((p) => (p.variants ?? []).map((v) => v.id))
    const haveSupplier = new Set(
      (variantIds.length
        ? await supplierModule.listSupplierProducts({ variant_id: variantIds }, { take: null })
        : []
      ).map((sp) => sp.variant_id)
    )

    try {
      await offersModule.ensureOffers(variantIds, channelIds)
    } catch (error) {
      report.supplierFailures.push({ item: 'channel-offers', reason: message(error) })
    }

    await mapLimit(found, IMAGE_CONCURRENCY, async (product) => {
      const planned = chunk.find((p) => p.handle === product.handle)
      const variantId = product.variants?.[0]?.id

      if (!planned || !variantId) {
        return
      }

      if (!haveSupplier.has(variantId)) {
        try {
          await createSupplierProductWorkflow(container).run({
            input: {
              supplier_id: supplierId as string,
              variant_id: variantId,
              supplier_sku: planned.item,
              supplier_title: planned.title,
              unit_cost: dollars(planned.costCents),
            },
          })
          report.supplierProducts += 1
        } catch (error) {
          report.supplierFailures.push({ item: planned.item, reason: message(error) })
        }
      }

      if (!product.thumbnail && planned.imageUrl) {
        try {
          const { bytes, type } = await download(planned.imageUrl)
          const file = await fileModule.createFiles({
            filename: `perfume-center/${planned.sku}.${type === 'image/png' ? 'png' : 'jpg'}`,
            mimeType: type,
            content: bytes.toString('base64'),
            access: 'public',
          })
          await updateProductsWorkflow(container).run({
            input: {
              products: [{ id: product.id, thumbnail: file.url, images: [{ url: file.url }] }],
            },
          })
          report.imagesRepaired += 1
        } catch (error) {
          report.imageUnavailable.push({ item: planned.item, reason: message(error) })
        }
      }
    })
    saveReport()
  })

  saveReport()
  logger.info(
    `Done. Created ${report.createdProducts} products, ${report.supplierProducts} supplier records. Pictures repaired: ${report.imagesRepaired}. Pictures still missing: ${report.imageUnavailable.length}. Product failures: ${report.productFailures.length}. Supplier failures: ${report.supplierFailures.length}. Report: ${reportPath}`
  )
}
