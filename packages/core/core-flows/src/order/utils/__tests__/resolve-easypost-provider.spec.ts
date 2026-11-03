import { asValue, createContainer } from "@medusajs/framework/awilix"
import { Modules } from "@medusajs/framework/utils"
import {
  EASYPOST_FULFILLMENT_PROVIDER_ID,
  resolveEasyPostFulfillmentProvider,
} from "../resolve-easypost-provider"

describe("resolveEasyPostFulfillmentProvider", () => {
  it("resolves the provider through the Fulfillment Module's own provider registry, by its registered provider id", () => {
    const provider = { buyRate: jest.fn() }
    const retrieveProviderRegistration = jest.fn(() => provider)
    const container = createContainer()
    container.register(
      Modules.FULFILLMENT,
      asValue({ fulfillmentProviderService_: { retrieveProviderRegistration } })
    )

    expect(resolveEasyPostFulfillmentProvider(container as any)).toBe(provider)
    expect(retrieveProviderRegistration).toHaveBeenCalledWith(
      EASYPOST_FULFILLMENT_PROVIDER_ID
    )
    expect(EASYPOST_FULFILLMENT_PROVIDER_ID).toBe("easypost_easypost")
  })

  it("fails with a clear error when the module's provider registry isn't reachable", () => {
    const container = createContainer()
    container.register(Modules.FULFILLMENT, asValue({}))

    expect(() => resolveEasyPostFulfillmentProvider(container as any)).toThrow(
      /provider registry/
    )
  })
})
