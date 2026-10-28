import { ITaxModuleService } from "@medusajs/types"

export const setupTaxStructure = async (service: ITaxModuleService) => {
  const [us] = await service.createTaxRegions([
    {
      country_code: "US",
      provider_id: "tp_system",
      default_tax_rate: { name: "US Default Rate", rate: 2, code: "US_DEF" },
    },
  ])

  await service.createTaxRegions([
    {
      country_code: "US",
      province_code: "NY",
      parent_id: us.id,
      default_tax_rate: {
        rate: 6,
        name: "NY Default Rate",
        code: "NYDEFAULT",
      },
    },
  ])
}
