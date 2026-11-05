import { Button } from "@medusajs/ui"
import type { AdminPurchase } from "../types"

// Placeholder: Task 11 replaces this with the real receive goods dialog.
export function ReceiveGoodsDialog(_props: {
  purchase: AdminPurchase
  onReceived?: () => void
}) {
  return <Button size="small">Receive goods</Button>
}
