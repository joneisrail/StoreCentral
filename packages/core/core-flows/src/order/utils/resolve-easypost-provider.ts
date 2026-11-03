import { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

/**
 * The fulfillment provider id the EasyPost provider is registered (and
 * persisted in the `fulfillment_provider` table) under: the provider class's
 * static `identifier` (`"easypost"`) joined with the configured provider
 * `id` in medusa-config.ts (`"easypost"`) - see
 * `FulfillmentProviderService.getRegistrationIdentifier`. This is the value a
 * fulfillment's `provider_id` must carry for the Fulfillment Module to route
 * `createFulfillment`/`cancelFulfillment` to EasyPost.
 */
export const EASYPOST_FULFILLMENT_PROVIDER_ID = "easypost_easypost"

/**
 * Resolves the live EasyPost fulfillment provider service instance.
 *
 * Fulfillment providers are NOT registered in the application's root
 * container: the Fulfillment Module's provider loader registers each one as
 * `fp_<provider id>` in the module's own, isolated local container (see
 * `packages/core/modules-sdk/src/loaders/utils/load-internal.ts`, which
 * builds that container with a fresh `createMedusaContainer()`, and
 * `packages/modules/fulfillment/src/loaders/providers.ts`). A
 * `container.resolve("fp_easypost_easypost")` from a route or workflow step
 * therefore throws `AwilixResolutionError` in a real running app - confirmed
 * against the real integration-test app container.
 *
 * The Fulfillment Module's own provider service (the same one it uses to
 * call `createFulfillment`/`cancelFulfillment` on a provider) is the only
 * in-process path to that instance, so this reaches it through the module
 * service. That service is vendored in this repo
 * (`packages/modules/fulfillment`), which is what makes relying on its
 * internal `fulfillmentProviderService_` field acceptable here; the shape is
 * checked at runtime so a future upstream rename fails loudly with a clear
 * message instead of an opaque `undefined is not a function`.
 */
export function resolveEasyPostFulfillmentProvider<T>(
  container: Pick<MedusaContainer, "resolve">
): T {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as {
    fulfillmentProviderService_?: {
      retrieveProviderRegistration?: (providerId: string) => unknown
    }
  }

  const providerService = fulfillmentModule?.fulfillmentProviderService_
  if (typeof providerService?.retrieveProviderRegistration !== "function") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to reach the Fulfillment Module's provider registry to resolve the EasyPost fulfillment provider."
    )
  }

  return providerService.retrieveProviderRegistration(
    EASYPOST_FULFILLMENT_PROVIDER_ID
  ) as T
}
