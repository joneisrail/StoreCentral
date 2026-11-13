const mockLinkLocation = jest.fn()
const mockLinkProducts = jest.fn()
const mockCreateInputs: unknown[] = []

jest.mock("@medusajs/medusa/core-flows", () => {
  const sdk = require("@medusajs/framework/workflows-sdk")
  const fakeStep = sdk.createStep("fake-create-sales-channels", async (input: any) => {
    mockCreateInputs.push(input)
    return new sdk.StepResponse(
      input.salesChannelsData.map((d: any, i: number) => ({ id: `sc_${i + 1}`, name: d.name }))
    )
  })
  return {
    createSalesChannelsWorkflow: sdk.createWorkflow(
      "fake-create-sales-channels-workflow",
      function (input: any) {
        return new sdk.WorkflowResponse(fakeStep(input))
      }
    ),
    linkSalesChannelsToStockLocationWorkflow: () => ({ run: mockLinkLocation }),
    linkProductsToSalesChannelWorkflow: () => ({ run: mockLinkProducts }),
  }
})

import { createMedusaContainer } from "@medusajs/framework/utils"
import { createMarketplaceSalesChannelWorkflow } from "../create-marketplace-sales-channel"

const makeContainer = (stockLocations: any[], products: any[]) => {
  const container = createMedusaContainer()
  const query = {
    graph: async ({ entity }: { entity: string }) => ({
      data: entity === "stock_location" ? stockLocations : products,
    }),
  }
  container.register("query", { resolve: () => query } as any)
  return container
}

beforeEach(() => {
  mockLinkLocation.mockReset()
  mockLinkProducts.mockReset()
  mockCreateInputs.length = 0
})

describe("createMarketplaceSalesChannelWorkflow", () => {
  it("workflow creates the channel and links stock locations and products", async () => {
    const container = makeContainer(
      [
        { id: "sloc_1", sales_channels: [] },
        { id: "sloc_2", sales_channels: [{ id: "sc_1" }] },
      ],
      [
        { id: "prod_1", sales_channels: [] },
        { id: "prod_2", sales_channels: [{ id: "sc_1" }] },
        { id: "prod_3" },
      ]
    )
    const { result } = await createMarketplaceSalesChannelWorkflow(container as any).run({
      input: { name: "Shopify EU", description: "desc" },
    })
    expect(result).toEqual({ id: "sc_1", name: "Shopify EU" })
    expect((mockCreateInputs[0] as any).salesChannelsData).toEqual([
      { name: "Shopify EU", description: "desc", is_disabled: undefined },
    ])
    expect(mockLinkLocation).toHaveBeenCalledTimes(1)
    expect(mockLinkLocation).toHaveBeenCalledWith({ input: { id: "sloc_1", add: ["sc_1"] } })
    expect(mockLinkProducts).toHaveBeenCalledWith({
      input: { id: "sc_1", add: ["prod_1", "prod_3"] },
    })
  })

  it("skips product linking when every product is already linked", async () => {
    const container = makeContainer([], [{ id: "p", sales_channels: [{ id: "sc_1" }] }])
    await createMarketplaceSalesChannelWorkflow(container as any).run({ input: { name: "X" } })
    expect(mockLinkLocation).not.toHaveBeenCalled()
    expect(mockLinkProducts).not.toHaveBeenCalled()
  })
})
