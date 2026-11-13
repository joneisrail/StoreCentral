/**
 * Creates the "Shopify" sales channel used by apps/seller-hub to place draft
 * orders synced in from Shopify, and links it to the existing stock location
 * and products so draft orders can actually be created against it
 * (`POST /admin/draft-orders` 400s with "Sales channel ... is not
 * associated with any stock location for variant ..." otherwise).
 *
 *   npx medusa exec ./src/scripts/setup-shopify-channel.ts
 *
 * Safe to re-run: the channel/links are only created if missing.
 */
import {
  createSalesChannelsWorkflow,
  linkProductsToSalesChannelWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

const CHANNEL_NAME = 'Shopify'
const CHANNEL_DESCRIPTION = 'Orders synced in from Shopify via seller-hub'

export default async function setupShopifyChannel({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existingChannels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
  })

  let channel: { id: string } | undefined = existingChannels.find(
    (c) => c.name === CHANNEL_NAME
  )
  if (channel) {
    logger.info(`Sales channel "${CHANNEL_NAME}" already exists: ${channel.id}`)
  } else {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          { name: CHANNEL_NAME, description: CHANNEL_DESCRIPTION },
        ],
      },
    })
    const created = result[0]
    if (!created) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        'createSalesChannelsWorkflow returned no sales channel'
      )
    }
    channel = { id: created.id }
    logger.info(`Created sales channel "${CHANNEL_NAME}": ${channel.id}`)
  }

  // ---- Link stock location + products so draft orders can be placed ----

  const { data: stockLocations } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'name', 'sales_channels.id'],
  })
  if (!stockLocations.length) {
    logger.info('No stock location found, skipping stock location link.')
  }
  for (const stockLocation of stockLocations) {
    if (stockLocation.sales_channels?.some((sc) => sc?.id === channel.id)) {
      logger.info(`Stock location "${stockLocation.name}" already linked to "${CHANNEL_NAME}", skipping.`)
      continue
    }
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [channel.id] },
    })
    logger.info(`Linked stock location "${stockLocation.name}" to "${CHANNEL_NAME}"`)
  }

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'sales_channels.id'],
  })
  const unlinkedProductIds = products
    .filter((p) => !p.sales_channels?.some((sc) => sc?.id === channel.id))
    .map((p) => p.id)

  if (unlinkedProductIds.length) {
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: channel.id, add: unlinkedProductIds },
    })
    logger.info(`Linked ${unlinkedProductIds.length} product(s) to "${CHANNEL_NAME}"`)
  } else {
    logger.info(`All products already linked to "${CHANNEL_NAME}", skipping.`)
  }

  logger.info('Shopify sales channel setup complete.')
}
