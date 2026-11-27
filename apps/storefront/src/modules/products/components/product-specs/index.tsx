import { HttpTypes } from "@medusajs/types"

export const getSpecRows = (
  product: HttpTypes.StoreProduct
): Array<{ label: string; value: string }> => {
  const barcode = product.variants?.find((v) => v.barcode?.trim())?.barcode
  const hasDimensions = product.length && product.width && product.height

  const rows: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Country of origin", value: product.origin_country },
    { label: "Barcode", value: barcode },
    { label: "Weight", value: product.weight ? `${product.weight} g` : null },
    {
      label: "Dimensions",
      value: hasDimensions
        ? `${product.length} x ${product.width} x ${product.height}`
        : null,
    },
    { label: "Material", value: product.material },
    { label: "Type", value: product.type?.value },
  ]

  return rows.filter(
    (row): row is { label: string; value: string } =>
      typeof row.value === "string" && row.value.trim() !== ""
  )
}

const ProductSpecs = ({ product }: { product: HttpTypes.StoreProduct }) => {
  const rows = getSpecRows(product)

  if (rows.length === 0) {
    return null
  }

  return (
    <dl className="grid gap-y-3 py-4 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-x-4">
          <dt className="w-36 shrink-0 text-warm-grey">{row.label}</dt>
          <dd className="text-charcoal">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default ProductSpecs
