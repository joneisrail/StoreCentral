import { VariantPrice } from "types/global"

export function PriceLabels({
  priceLabel,
  originalPriceLabel,
}: {
  priceLabel?: string | null
  originalPriceLabel?: string | null
}) {
  if (!priceLabel) {
    return null
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {originalPriceLabel && (
        <span
          className="text-warm-grey line-through"
          data-testid="original-price"
        >
          {originalPriceLabel}
        </span>
      )}
      <span
        className={originalPriceLabel ? "text-gold-deep" : "text-charcoal"}
        data-testid="price"
      >
        {priceLabel}
      </span>
    </div>
  )
}

export default function PreviewPrice({ price }: { price: VariantPrice }) {
  if (!price) {
    return null
  }

  return (
    <PriceLabels
      priceLabel={price.calculated_price}
      originalPriceLabel={
        price.price_type === "sale" ? price.original_price : null
      }
    />
  )
}
