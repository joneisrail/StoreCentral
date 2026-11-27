/**
 * Puts every imported Perfume Center product into its department category
 * (Men, Women, Unisex, ...), taken from the DEPT value the import stored in
 * product metadata. Run after the import; safe to run again.
 *
 *   npx medusa exec ./src/scripts/assign-perfume-center-categories.ts
 */
import {
  batchLinkProductsToCategoryWorkflow,
  createProductCategoriesWorkflow,
} from '@medusajs/medusa/core-flows'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { DEPT_CATEGORIES, SOURCE_LABEL } from './helpers/perfume-center'

const CHUNK = 200

export default async function assignPerfumeCenterCategories({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const eventBus = container.resolve(Modules.EVENT_BUS)

  const { data: categories } = await query.graph({
    entity: 'product_category',
    fields: ['id', 'handle', 'name'],
  })
  const byHandle = new Map(categories.map((c) => [c.handle, c.id]))
  const missing = Object.values(DEPT_CATEGORIES).filter((c) => !byHandle.has(c.handle))

  if (missing.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missing.map((c) => ({ ...c, is_active: true })),
      },
    })

    for (const category of result) {
      byHandle.set(category.handle, category.id)
    }
    logger.info(`Created categories: ${missing.map((c) => c.name).join(', ')}`)
  }

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'metadata', 'categories.id'],
  })
  const wanted = new Map<string, string[]>()
  let alreadyLinked = 0

  for (const product of products) {
    const metadata = (product.metadata ?? {}) as Record<string, unknown>

    if (metadata.source !== SOURCE_LABEL) {
      continue
    }

    const category = DEPT_CATEGORIES[String(metadata.dept)]
    const categoryId = category ? byHandle.get(category.handle) : undefined

    if (!categoryId) {
      continue
    }

    if ((product.categories ?? []).some((c) => c?.id === categoryId)) {
      alreadyLinked += 1
      continue
    }

    wanted.set(categoryId, [...(wanted.get(categoryId) ?? []), product.id])
  }

  const changed: string[] = []

  for (const [categoryId, ids] of wanted) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)

      await batchLinkProductsToCategoryWorkflow(container).run({
        input: { id: categoryId, add: chunk },
      })
      changed.push(...chunk)
    }
  }

  // The link workflow emits no event, so the search index is told by hand.
  for (let i = 0; i < changed.length; i += CHUNK) {
    await eventBus.emit(
      changed.slice(i, i + CHUNK).map((id) => ({ name: 'product.updated', data: { id } }))
    )
  }

  logger.info(`Linked ${changed.length} products to department categories (${alreadyLinked} already were).`)
}
