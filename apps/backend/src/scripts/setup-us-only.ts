/**
 * Restricts the store to the US market only:
 *  - soft-deletes the "Europe" region (and all non-US regions), so only
 *    United States is sellable
 *  - sets the store's supported currencies to USD only (removes EUR as a
 *    supported/default currency)
 *
 *   npx medusa exec ./src/scripts/setup-us-only.ts
 *
 * Safe to re-run: skips anything already in the desired state.
 */
import {
  deleteRegionsWorkflow,
  updateStoresWorkflow,
} from '@medusajs/medusa/core-flows'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

export default async function setupUsOnly({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // ---- Remove non-US regions -------------------------------------------------

  const { data: regions } = await query.graph({
    entity: 'region',
    fields: ['id', 'name', 'currency_code'],
  })

  const nonUsRegions = regions.filter((r) => r.currency_code !== 'usd')

  if (nonUsRegions.length) {
    await deleteRegionsWorkflow(container).run({
      input: { ids: nonUsRegions.map((r) => r.id) },
    })
    logger.info(
      `Deleted ${nonUsRegions.length} non-US region(s): ${nonUsRegions
        .map((r) => r.name)
        .join(', ')}`
    )
  } else {
    logger.info('No non-US regions found, skipping.')
  }

  // ---- Store currencies: USD only --------------------------------------------

  const { data: stores } = await query.graph({
    entity: 'store',
    fields: ['id', 'supported_currencies.currency_code'],
  })
  const store = stores[0]

  const currencies = store.supported_currencies?.map((c) => c.currency_code) ?? []
  const isUsdOnly = currencies.length === 1 && currencies[0] === 'usd'

  if (!isUsdOnly) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_currencies: [{ currency_code: 'usd', is_default: true }],
        },
      },
    })
    logger.info('Store supported currencies set to USD only.')
  } else {
    logger.info('Store already USD-only, skipping.')
  }

  logger.info('US-only setup complete.')
}
