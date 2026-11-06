import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Checkbox, Input, Label, Text } from "@medusajs/ui"
import { sdk } from "../../../../../lib/sdk"
import { errorMessage, formatUsd } from "../../../../purchases/format"
import type { AdminPurchaseItem } from "../../../../purchases/types"
import { newLineKey } from "../line-entry"
import type { Line } from "../line-entry"

type VariantResult = {
  id: string
  title: string | null
  sku: string | null
  product?: { title: string | null } | null
}

type SupplierProductRow = {
  supplier_sku: string
  unit_cost: number | string | null
  variant_id: string
  variant: {
    title: string | null
    product: { title: string | null } | null
  } | null
}

const VARIANT_LIMIT = 5
const SEARCH_DEBOUNCE_MS = 300

function variantLabel(variant: VariantResult) {
  return (
    [variant.product?.title, variant.title].filter(Boolean).join(" - ") ||
    "Untitled variant"
  )
}

type Staged = {
  variant_id: string
  label: string
  code: string
  cost: string
  // True when the code was found on the supplier's list (nothing to remember).
  known: boolean
}

// Adds one line by the supplier's code. A code on the supplier's list resolves
// to its variant; an unknown code asks for the product instead.
export const CodeEntry = ({
  supplierId,
  purchaseItems,
  onAdd,
}: {
  supplierId: string
  purchaseItems: AdminPurchaseItem[]
  onAdd: (line: Line) => void
}) => {
  const [code, setCode] = useState("")
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The code that did not match anything, while the picker is open.
  const [unmatched, setUnmatched] = useState<string | null>(null)
  const [staged, setStaged] = useState<Staged | null>(null)
  const [remember, setRemember] = useState(false)
  const [purchaseItemId, setPurchaseItemId] = useState("")
  const [variantQuery, setVariantQuery] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const requestId = useRef(0)

  const reset = () => {
    requestId.current += 1
    setCode("")
    setResolving(false)
    setError(null)
    setUnmatched(null)
    setStaged(null)
    setRemember(false)
    setPurchaseItemId("")
    setVariantQuery("")
    setSubmittedQuery("")
  }

  const variants = useQuery({
    queryKey: ["admin", "invoice-variant-search", submittedQuery],
    enabled: unmatched !== null && staged === null,
    queryFn: () =>
      sdk.admin.productVariant.list({
        ...(submittedQuery ? { q: submittedQuery } : {}),
        limit: VARIANT_LIMIT,
        fields: "id,title,sku,product.title",
      }),
  })

  // Search as you type, after a short pause.
  useEffect(() => {
    const trimmed = variantQuery.trim()
    if (trimmed === submittedQuery) {
      return
    }
    const timer = setTimeout(
      () => setSubmittedQuery(trimmed),
      SEARCH_DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [variantQuery, submittedQuery])

  const candidatesFor = (variantId: string) =>
    purchaseItems.filter((p) => p.variant_id === variantId)

  const addLine = (s: Staged, itemId: string | null, rememberCode: boolean) => {
    onAdd({
      key: newLineKey(),
      purchase_item_id: itemId,
      variant_id: s.variant_id,
      supplier_sku: s.code,
      remember_code: rememberCode,
      label: s.label,
      quantity: "1",
      unit_cost: s.cost,
    })
    reset()
  }

  // The supplier's cost when set, else the ordered cost of the one matching
  // purchase item, else 0.
  const defaultCost = (variantId: string, supplierCost: string) => {
    if (supplierCost !== "") {
      return supplierCost
    }
    const candidates = candidatesFor(variantId)
    return candidates.length === 1 ? String(candidates[0].unit_cost) : "0"
  }

  // Add straight away unless there is a choice left to make.
  const proceed = (s: Staged) => {
    const candidates = candidatesFor(s.variant_id)
    if (s.known && candidates.length <= 1) {
      addLine(s, candidates[0]?.id ?? null, false)
      return
    }
    setStaged(s)
    setRemember(false)
    setPurchaseItemId(candidates.length === 1 ? candidates[0].id : "")
  }

  const handleResolve = async (event: React.FormEvent) => {
    event.preventDefault()
    const typed = code.trim()
    if (!typed || resolving) {
      return
    }
    const id = ++requestId.current
    setResolving(true)
    setError(null)
    setUnmatched(null)
    setStaged(null)
    try {
      const response = await sdk.client.fetch<{
        supplier_products: SupplierProductRow[]
      }>(`/admin/suppliers/${supplierId}/products`, {
        query: { q: typed, limit: 100 },
      })
      if (id !== requestId.current) {
        return
      }
      const match = response.supplier_products.find(
        (row) => row.supplier_sku.toLowerCase() === typed.toLowerCase()
      )
      setResolving(false)
      if (match) {
        const supplierCost =
          match.unit_cost === null || match.unit_cost === undefined
            ? ""
            : String(Number(match.unit_cost))
        proceed({
          variant_id: match.variant_id,
          label:
            [match.variant?.product?.title, match.variant?.title]
              .filter(Boolean)
              .join(" - ") ||
            candidatesFor(match.variant_id)[0]?.title ||
            "Untitled variant",
          code: match.supplier_sku,
          cost: defaultCost(match.variant_id, supplierCost),
          known: true,
        })
      } else {
        setUnmatched(typed)
        setVariantQuery("")
        setSubmittedQuery("")
      }
    } catch (err) {
      if (id !== requestId.current) {
        return
      }
      setResolving(false)
      setError(errorMessage(err, "Could not look up that code."))
    }
  }

  const pick = (variant: VariantResult) => {
    proceed({
      variant_id: variant.id,
      label: variantLabel(variant),
      code: unmatched ?? code.trim(),
      cost: defaultCost(variant.id, ""),
      known: false,
    })
  }

  const candidates = staged ? candidatesFor(staged.variant_id) : []

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleResolve} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="invoice-code">Supplier code</Label>
          <Input
            id="invoice-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="small"
          variant="secondary"
          isLoading={resolving}
          disabled={code.trim() === "" || resolving}
        >
          Add line
        </Button>
      </form>
      {error && (
        <Text role="alert" size="small" className="text-ui-fg-error">
          {error}
        </Text>
      )}

      {unmatched !== null && staged === null && (
        <div className="flex flex-col gap-2 rounded-md p-3 shadow-borders-base">
          <Text size="small">
            No product with the code &quot;{unmatched}&quot; for this supplier.
            Find the product instead.
          </Text>
          <Input
            type="search"
            aria-label="Search products"
            placeholder="Search products"
            value={variantQuery}
            onChange={(event) => setVariantQuery(event.target.value)}
          />
          {variants.isFetching && <Text size="small">Searching...</Text>}
          {variants.isError && (
            <Text className="text-ui-fg-error">
              Something went wrong searching products.
            </Text>
          )}
          {!variants.isFetching && variants.data && (
            <>
              {variants.data.variants.length === 0 && (
                <Text size="small">No products match your search.</Text>
              )}
              <ul className="flex flex-col gap-1">
                {variants.data.variants
                  .slice(0, VARIANT_LIMIT)
                  .map((variant: VariantResult) => {
                    const label = `${variantLabel(variant)} (${variant.sku ?? "no SKU"})`
                    return (
                      <li
                        key={variant.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <Text>{label}</Text>
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          aria-label={`Choose ${label}`}
                          onClick={() => pick(variant)}
                        >
                          Choose
                        </Button>
                      </li>
                    )
                  })}
              </ul>
              {(variants.data.count ?? 0) > VARIANT_LIMIT && (
                <Text size="small" className="text-ui-fg-subtle">
                  Showing the first {VARIANT_LIMIT} — type to narrow the results
                </Text>
              )}
            </>
          )}
          <div>
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={reset}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {staged && (
        <div className="flex flex-col gap-2 rounded-md p-3 shadow-borders-base">
          <Text>Adding: {staged.label}</Text>
          {candidates.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-purchase-item">
                Which purchase item?
              </Label>
              <select
                id="invoice-purchase-item"
                className="bg-ui-bg-field text-ui-fg-base shadow-borders-base h-8 rounded-md px-2 text-sm"
                value={purchaseItemId}
                onChange={(event) => setPurchaseItemId(event.target.value)}
              >
                <option value="">Select a purchase item</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {`${candidate.title} - ordered ${candidate.quantity} at ${formatUsd(candidate.unit_cost)}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!staged.known && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="invoice-remember-code"
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              <Label htmlFor="invoice-remember-code">
                Remember this code for this supplier
              </Label>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="small"
              disabled={candidates.length > 1 && purchaseItemId === ""}
              onClick={() =>
                addLine(
                  staged,
                  candidates.length > 0 ? purchaseItemId || null : null,
                  !staged.known && remember
                )
              }
            >
              Add to invoice
            </Button>
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={reset}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
