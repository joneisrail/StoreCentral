"use client"

import { useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { addToCart } from "@lib/data/cart"
import { Button } from "@modules/common/components/ui"
import { useToast } from "@modules/common/components/toast"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type QuickAddProps = {
  productId: string
  title: string
  inStock: boolean | null | undefined
  singleVariantId: string | null | undefined
  href: string
}

const QuickAdd = ({ title, inStock, singleVariantId, href }: QuickAddProps) => {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  const countryCode = String(params?.countryCode ?? "")

  if (inStock === false) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="small"
        disabled
        aria-label={`Sold out: ${title}`}
        className="w-full"
      >
        Sold out
      </Button>
    )
  }

  if (singleVariantId) {
    const onAdd = async () => {
      if (inFlight.current) {
        return
      }
      inFlight.current = true
      setPending(true)
      try {
        await addToCart({ variantId: singleVariantId, quantity: 1, countryCode })
        toast({ title: "Added to cart", tone: "success" })
        router.refresh()
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
        variant="primary"
        size="small"
        disabled={pending}
        aria-label={`Add to cart: ${title}`}
        onClick={onAdd}
        className="w-full"
      >
        Add to cart
      </Button>
    )
  }

  return (
    <LocalizedClientLink
      href={href}
      aria-label={`Choose options: ${title}`}
      className="inline-flex w-full min-h-[44px] lg:min-h-0 h-8 items-center justify-center rounded-base border border-line-strong bg-paper px-3 text-sm font-medium text-charcoal transition-colors motion-reduce:transition-none hover:bg-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"
    >
      Choose options
    </LocalizedClientLink>
  )
}

export default QuickAdd
