/**
 * Adds a couple of extra sales channels (Point of Sale, Mobile App) alongside
 * the existing Default Sales Channel, wires the existing stock location and
 * products into all of them, and issues a publishable API key scoped to each
 * new channel so a POS/mobile client could authenticate against only its own
 * channel's catalog.
 *
 *   npx medusa exec ./src/scripts/setup-omnichannel.ts
 *
 * Safe to re-run: channels/keys are only created if a channel with the same
 * name doesn't already exist.
 */
import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  linkProductsToSalesChannelWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

const NEW_CHANNELS = [
  { name: 'Point of Sale', description: 'In-store POS terminals' },
  { name: 'Mobile App', description: 'iOS/Android shopping app' },
]

export default async function setupOmnichannel({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existingChannels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
  })

  const missingChannels = NEW_CHANNELS.filter(
    (c) => !existingChannels.some((e) => e.name === c.name)
  )

  let createdChannels: { id: string; name: string }[] = []
  if (missingChannels.length) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: missingChannels },
    })
    createdChannels = result
    logger.info(`Created ${result.length} sales channel(s): ${result.map((c) => c.name).join(', ')}`)
  } else {
    logger.info('All target sales channels already exist, skipping creation.')
  }

  const { data: allChannels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
  })
  const targetChannels = allChannels.filter((c) =>
    NEW_CHANNELS.some((n) => n.name === c.name)
  )

  const { data: stockLocations } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'name'],
  })
  const stockLocation = stockLocations[0]
  if (!stockLocation) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'No stock location found. Run the initial data seed first.'
    )
  }

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id'],
  })
  const productIds = products.map((p) => p.id)

  const { data: users } = await query.graph({
    entity: 'user',
    fields: ['id'],
  })
  const createdBy = users[0]?.id

  for (const channel of targetChannels) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [channel.id] },
    })

    if (productIds.length) {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id: channel.id, add: productIds },
      })
    }

    logger.info(
      `Linked stock location "${stockLocation.name}" and ${productIds.length} product(s) to "${channel.name}"`
    )
  }

  // ---- Publishable API key per new channel ---------------------------------

  const { data: existingKeys } = await query.graph({
    entity: 'api_key',
    fields: ['id', 'title', 'token', 'type'],
  })

  for (const channel of targetChannels) {
    const keyTitle = `${channel.name} Key`
    const existing = existingKeys.find((k) => k.title === keyTitle)
    if (existing) {
      logger.info(`API key "${keyTitle}" already exists: ${existing.token}`)
      continue
    }

    const { result: createdKeys } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: keyTitle,
            type: 'publishable',
            created_by: createdBy ?? '',
          },
        ],
      },
    })
    const key = createdKeys[0]

    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [channel.id] },
    })

    logger.info(`Created publishable key for "${channel.name}": ${key.token}`)
  }

  logger.info('Omnichannel setup complete.')
}
