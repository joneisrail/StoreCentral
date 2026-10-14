/**
 * Adds a United States region (USD) so the storefront/POS/mobile channels can
 * sell there: creates the region, a "United States" service zone under the
 * existing fulfillment set (reusing the same warehouse/stock location), and
 * USD shipping options for it. Products already have USD prices from the
 * demo seed, and USD is already a supported store currency.
 *
 *   npx medusa exec ./src/scripts/setup-us-market.ts
 *
 * Safe to re-run: skips anything that already exists by name.
 */
import {
  createRegionsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
} from '@medusajs/medusa/core-flows'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

const REGION_NAME = 'United States'
const SERVICE_ZONE_NAME = 'United States'

export default async function setupUsMarket({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // ---- Region ---------------------------------------------------------------

  const { data: existingRegions } = await query.graph({
    entity: 'region',
    fields: ['id', 'name'],
  })

  let region = existingRegions.find((r) => r.name === REGION_NAME)
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: 'usd',
            countries: ['us'],
            payment_providers: ['pp_system_default'],
          },
        ],
      },
    })
    region = result[0]
    logger.info(`Created region "${region.name}" (${region.id})`)
  } else {
    logger.info(`Region "${REGION_NAME}" already exists, skipping creation.`)
  }

  // ---- Service zone + shipping options --------------------------------------

  const { data: fulfillmentSets } = await query.graph({
    entity: 'fulfillment_set',
    fields: ['id', 'name'],
  })
  const fulfillmentSet = fulfillmentSets[0]
  if (!fulfillmentSet) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'No fulfillment set found. Run the initial data seed first.'
    )
  }

  const { data: existingZones } = await query.graph({
    entity: 'service_zone',
    fields: ['id', 'name'],
  })

  let serviceZone = existingZones.find((z) => z.name === SERVICE_ZONE_NAME)
  if (!serviceZone) {
    const { result } = await createServiceZonesWorkflow(container).run({
      input: {
        data: [
          {
            name: SERVICE_ZONE_NAME,
            fulfillment_set_id: fulfillmentSet.id,
            geo_zones: [{ type: 'country', country_code: 'us' }],
          },
        ],
      },
    })
    serviceZone = result[0]
    logger.info(`Created service zone "${serviceZone.name}" (${serviceZone.id})`)
  } else {
    logger.info(`Service zone "${SERVICE_ZONE_NAME}" already exists, skipping creation.`)
  }

  const { data: shippingProfiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })
  const shippingProfile = shippingProfiles[0]
  if (!shippingProfile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'No shipping profile found. Run the initial data seed first.'
    )
  }

  const { data: existingOptions } = await query.graph({
    entity: 'shipping_option',
    fields: ['id', 'name', 'service_zone_id'],
  })

  const optionsToCreate = [
    { name: 'US Standard Shipping', code: 'us-standard', amount: 10 },
    { name: 'US Express Shipping', code: 'us-express', amount: 20 },
  ].filter(
    (o) =>
      !existingOptions.some(
        (e) => e.name === o.name && e.service_zone_id === serviceZone!.id
      )
  )

  if (optionsToCreate.length) {
    await createShippingOptionsWorkflow(container).run({
      input: optionsToCreate.map((o) => ({
        name: o.name,
        service_zone_id: serviceZone!.id,
        shipping_profile_id: shippingProfile.id,
        provider_id: 'manual_manual',
        price_type: 'flat' as const,
        type: {
          label: o.name,
          description: o.name,
          code: o.code,
        },
        prices: [{ amount: o.amount, currency_code: 'usd' }],
      })),
    })
    logger.info(`Created ${optionsToCreate.length} US shipping option(s).`)
  } else {
    logger.info('US shipping options already exist, skipping creation.')
  }

  logger.info('US market setup complete.')
}
