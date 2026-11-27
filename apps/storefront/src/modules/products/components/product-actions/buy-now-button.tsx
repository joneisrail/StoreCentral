"use client"

import { useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { addToCart } from "@lib/data/cart"
import { Button } from "@modules/common/components/ui"
import { useToast } from "@modules/common/components/toast"

type BuyNowButtonProps = {
  variantId: string | undefined
  quantity: number
  disabled: boolean
}

const BuyNowButton = ({ variantId, quantity, disabled }: BuyNowButtonProps) => {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  const countryCode = String(params?.countryCode ?? "")

  const onClick = async () => {
    if (!variantId || inFlight.current) {
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      await addToCart({ variantId, quantity, countryCode })
      router.push(`/${countryCode}/checkout`)
    } catch {
      // Server actions hide thrown messages in production, so the text is fixed.
      toast({ title: "Couldn't add to cart", tone: "error" })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full h-10"
      disabled={disabled || !variantId}
      isLoading={pending}
      onClick={onClick}
      data-testid="buy-now-button"
    >
      Buy now
    </Button>
  )
}

export default BuyNowButton
