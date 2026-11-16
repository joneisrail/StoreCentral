import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readShareStockSetting } from "../../../modules/channel-offers/settings"
import { updateChannelStockSettingsWorkflow } from "../../../workflows/update-channel-stock-settings"
import type { UpdateChannelStockSettingsSchema } from "./middlewares"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ share_stock_after_sale: await readShareStockSetting(req.scope) })
}

export async function POST(
  req: AuthenticatedMedusaRequest<UpdateChannelStockSettingsSchema>,
  res: MedusaResponse
) {
  const { result } = await updateChannelStockSettingsWorkflow(req.scope).run({
    input: { share_stock_after_sale: req.validatedBody.share_stock_after_sale },
  })
  res.json(result)
}
