import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import { errorMessage, formatUsd } from "../format"
import type { AdminPurchase } from "../types"
import { calculateTotals } from "./totals"

type SupplierOption = { id: string; name: string }

type SuppliersResponse = {
  suppliers: SupplierOption[]
  count: number
  offset: number
  limit: number
}

type VariantResult = {
  id: string
  title: string | null
  sku: string | null
  product?: { title: string | null } | null
}

type ItemRow = {
  variant_id: string
  label: string
  quantity: string
  unit_cost: string
}

const SUPPLIER_LIMIT = 100
const VARIANT_LIMIT = 10

function variantLabel(variant: VariantResult) {
  return [variant.product?.title, variant.title].filter(Boolean).join(" - ")
}

// Blank optional amounts count as 0; anything else must be a number >= 0.
function parseOptionalAmount(value: string) {
  if (value.trim() === "") {
    return 0
  }
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function parseQuantity(value: string) {
  const quantity = Number(value)
  return value.trim() !== "" && Number.isInteger(quantity) && quantity > 0
    ? quantity
    : null
}

function parseUnitCost(value: string) {
  return value.trim() === "" ? null : parseOptionalAmount(value)
}

const NewPurchasePage = () => {
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState("")
  const [items, setItems] = useState<ItemRow[]>([])
  const [shipping, setShipping] = useState("")
  const [tax, setTax] = useState("")
  const [other, setOther] = useState("")
  const [notes, setNotes] = useState("")
  const [variantQuery, setVariantQuery] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const suppliers = useQuery({
    queryKey: ["admin", "suppliers", "options"],
    queryFn: () =>
      sdk.client.fetch<SuppliersResponse>("/admin/suppliers", {
        query: { limit: SUPPLIER_LIMIT },
      }),
  })

  const variants = useQuery({
    queryKey: ["admin", "purchase-variant-search", submittedQuery],
    enabled: submittedQuery !== "",
    queryFn: () =>
      sdk.admin.productVariant.list({
        q: submittedQuery,
        limit: VARIANT_LIMIT,
        fields: "id,title,sku,product.title",
      }),
  })

  const createPurchase = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ purchase: AdminPurchase }>("/admin/purchases", {
        method: "POST",
        body,
      }),
    onSuccess: ({ purchase }) => {
      toast.success("Purchase created")
      navigate(`/purchases/${purchase.id}`)
    },
    onError: (error: unknown) => {
      setFormError(errorMessage(error, "Failed to create the purchase."))
    },
  })

  const shippingCost = parseOptionalAmount(shipping)
  const taxAmount = parseOptionalAmount(tax)
  const otherCost = parseOptionalAmount(other)
  const parsedItems = items.map((item) => ({
    variant_id: item.variant_id,
    quantity: parseQuantity(item.quantity),
    unit_cost: parseUnitCost(item.unit_cost),
  }))
  const itemsValid =
    parsedItems.length > 0 &&
    parsedItems.every((i) => i.quantity !== null && i.unit_cost !== null)
  const canSave =
    supplierId !== "" &&
    itemsValid &&
    shippingCost !== null &&
    taxAmount !== null &&
    otherCost !== null &&
    !createPurchase.isPending

  // Rows with unparsable values count as 0 until they are fixed.
  const totals = calculateTotals(
    parsedItems.map((i) => ({
      quantity: i.quantity ?? 0,
      unit_cost: i.unit_cost ?? 0,
    })),
    {
      shipping_cost: shippingCost ?? 0,
      tax: taxAmount ?? 0,
      other_cost: otherCost ?? 0,
    }
  )

  const addVariant = (variant: VariantResult) => {
    setItems((current) =>
      current.some((item) => item.variant_id === variant.id)
        ? current
        : [
            ...current,
            {
              variant_id: variant.id,
              label: variantLabel(variant),
              quantity: "1",
              unit_cost: "0",
            },
          ]
    )
  }

  const updateItem = (
    variantId: string,
    field: "quantity" | "unit_cost",
    value: string
  ) => {
    setItems((current) =>
      current.map((item) =>
        item.variant_id === variantId ? { ...item, [field]: value } : item
      )
    )
  }

  const removeItem = (variantId: string) => {
    setItems((current) => current.filter((i) => i.variant_id !== variantId))
  }

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmittedQuery(variantQuery.trim())
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) {
      return
    }
    setFormError(null)

    const body: Record<string, unknown> = {
      supplier_id: supplierId,
      items: parsedItems,
      shipping_cost: shippingCost,
      tax: taxAmount,
      other_cost: otherCost,
    }
    if (notes.trim()) {
      body.notes = notes.trim()
    }
    createPurchase.mutate(body)
  }

  const addedIds = new Set(items.map((item) => item.variant_id))

  return (
    <Container>
      <Heading level="h1">New purchase</Heading>

      <div className="flex flex-col gap-6 pt-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="purchase-supplier">Supplier</Label>
          <select
            id="purchase-supplier"
            className="bg-ui-bg-field text-ui-fg-base shadow-borders-base h-8 rounded-md px-2 text-sm"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Select a supplier</option>
            {suppliers.data?.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          {suppliers.isLoading && <Text size="small">Loading suppliers...</Text>}
          {suppliers.isError && (
            <div className="flex items-center gap-2">
              <Text size="small" className="text-ui-fg-error">
                Something went wrong loading suppliers.
              </Text>
              <Button
                size="small"
                variant="secondary"
                type="button"
                onClick={() => suppliers.refetch()}
              >
                Retry
              </Button>
            </div>
          )}
          {suppliers.data && suppliers.data.count > SUPPLIER_LIMIT && (
            <Text size="small">
              Showing the first {SUPPLIER_LIMIT} of {suppliers.data.count}{" "}
              suppliers.
            </Text>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Heading level="h2">Items</Heading>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              type="search"
              placeholder="Search variants"
              value={variantQuery}
              onChange={(event) => setVariantQuery(event.target.value)}
            />
            <Button type="submit" size="small" variant="secondary">
              Search
            </Button>
          </form>

          {variants.isFetching && <Text>Searching...</Text>}
          {variants.isError && (
            <Text className="text-ui-fg-error">
              Something went wrong searching variants.
            </Text>
          )}
          {!variants.isFetching &&
            variants.data &&
            variants.data.variants.length === 0 && (
              <Text>No variants match your search.</Text>
            )}
          {!variants.isFetching && variants.data && (
            <ul className="flex flex-col gap-1">
              {variants.data.variants.map((variant: VariantResult) => {
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
                      aria-label={`Add ${label}`}
                      disabled={addedIds.has(variant.id)}
                      onClick={() => addVariant(variant)}
                    >
                      {addedIds.has(variant.id) ? "Added" : "Add"}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          {items.length === 0 ? (
            <Text>No items added yet.</Text>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Item</Table.HeaderCell>
                  <Table.HeaderCell>Quantity</Table.HeaderCell>
                  <Table.HeaderCell>Unit cost (USD)</Table.HeaderCell>
                  <Table.HeaderCell>Actions</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((item) => (
                  <Table.Row key={item.variant_id}>
                    <Table.Cell>{item.label}</Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        aria-label={`Quantity for ${item.label}`}
                        value={item.quantity}
                        onChange={(event) =>
                          updateItem(
                            item.variant_id,
                            "quantity",
                            event.target.value
                          )
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Unit cost for ${item.label}`}
                        value={item.unit_cost}
                        onChange={(event) =>
                          updateItem(
                            item.variant_id,
                            "unit_cost",
                            event.target.value
                          )
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        aria-label={`Remove ${item.label}`}
                        onClick={() => removeItem(item.variant_id)}
                      >
                        Remove
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="purchase-shipping">Shipping cost</Label>
              <Input
                id="purchase-shipping"
                type="number"
                min={0}
                step="0.01"
                value={shipping}
                onChange={(event) => setShipping(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="purchase-tax">Tax</Label>
              <Input
                id="purchase-tax"
                type="number"
                min={0}
                step="0.01"
                value={tax}
                onChange={(event) => setTax(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="purchase-other">Other cost</Label>
              <Input
                id="purchase-other"
                type="number"
                min={0}
                step="0.01"
                value={other}
                onChange={(event) => setOther(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="purchase-notes">Notes</Label>
            <Textarea
              id="purchase-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Text>
              Subtotal: <span data-testid="subtotal">{formatUsd(totals.subtotal)}</span>
            </Text>
            <Text weight="plus">
              Total: <span data-testid="total">{formatUsd(totals.total)}</span>
            </Text>
          </div>

          {formError && <Text className="text-ui-fg-error">{formError}</Text>}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate("/purchases")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createPurchase.isPending}
              disabled={!canSave}
            >
              Save
            </Button>
          </div>
        </form>
      </div>
    </Container>
  )
}

export default NewPurchasePage
