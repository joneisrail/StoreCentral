"use client"

import clsx from "clsx"
import { useToast } from "@modules/common/components/toast"
import { useWishlist } from "./use-wishlist"

type WishlistButtonProps = {
  productId: string
  title: string
}

const WishlistButton = ({ productId, title }: WishlistButtonProps) => {
  const { has, toggle } = useWishlist()
  const { toast } = useToast()
  const saved = has(productId)

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={
        saved ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`
      }
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        toggle(productId)
        toast({
          title: saved ? "Removed from wishlist" : "Added to wishlist",
          tone: "info",
        })
      }}
      className={clsx(
        "inline-flex h-11 w-11 items-center justify-center rounded-full bg-paper text-charcoal transition-colors motion-reduce:transition-none hover:bg-line",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={saved ? "text-gold-deep" : undefined}
      >
        <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.8 6.9 4.8c1.9 0 3.5 1 5.1 3 1.6-2 3.2-3 5.1-3 3.3 0 5.2 3.2 4.1 6.4-1.7 4.7-9.2 9.3-9.2 9.3z" />
      </svg>
    </button>
  )
}

export default WishlistButton
