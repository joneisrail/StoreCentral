import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button, Drawer, Input, Label, Text, toast } from "@medusajs/ui"
import { sdk } from "../../../../lib/sdk"
import type { SupplierProductRow } from "../../types"

type VariantResult = {
  id: string
  title: string | null
  sku: string | null
  product?: { title: string | null } | null
}

const VARIANT_LIMIT = 10

function variantLabel(variant: VariantResult) {
  const name = [variant.product?.title, variant.title]
    .filter(Boolean)
    .join(" - ")
  return `${name} (${variant.sku ?? "no SKU"})`
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

// Mounted only while open, so every opening starts from a clean form.
export const AddProductDialog = ({
  supplierId,
  onClose,
}: {
  supplierId: string
  onClose: () => void
}) => {
  const queryClient = useQueryClient()
  const [variantQuery, setVariantQuery] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [selected, setSelected] = useState<VariantResult | null>(null)
  const [code, setCode] = useState("")
  const [title, setTitle] = useState("")
  const [cost, setCost] = useState("")
  const [error, setError] = useState<string | null>(null)

  const variants = useQuery({
    queryKey: ["admin", "supplier-variant-search", submittedQuery],
    enabled: submittedQuery !== "",
    queryFn: () =>
      sdk.admin.productVariant.list({
        q: submittedQuery,
        limit: VARIANT_LIMIT,
        fields: "id,title,sku,product.title",
      }),
  })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ supplier_product: SupplierProductRow }>(
        `/admin/suppliers/${supplierId}/products`,
        { method: "POST", body }
      ),
    onSuccess: () => {
      toast.success("Product added")
      queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] })
      onClose()
    },
    onError: (err: unknown) => {
      setError(errorMessage(err, "Failed to add the product."))
    },
  })

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmittedQuery(variantQuery.trim())
  }

  const handleSave = () => {
    setError(null)
    if (!selected) {
      setError("Pick one of our variants first.")
      return
    }
    if (!code.trim()) {
      setError("Supplier code is required.")
      return
    }

    const body: Record<string, unknown> = {
      variant_id: selected.id,
      supplier_sku: code.trim(),
    }
    if (title.trim()) {
      body.supplier_title = title.trim()
    }
    if (cost.trim()) {
      const parsed = Number(cost)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Unit cost must be a number of 0 or more.")
        return
      }
      body.unit_cost = parsed
    }
    create.mutate(body)
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Add product</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4">
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
          {!variants.isFetching && variants.data && (
            <>
              {variants.data.variants.length === 0 && (
                <Text>No variants match your search.</Text>
              )}
              <ul className="flex flex-col gap-1">
                {variants.data.variants.map((variant: VariantResult) => {
                  const label = variantLabel(variant)
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
                        aria-label={`Select ${label}`}
                        disabled={selected?.id === variant.id}
                        onClick={() => setSelected(variant)}
                      >
                        {selected?.id === variant.id ? "Selected" : "Select"}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {selected && <Text>Linking to: {variantLabel(selected)}</Text>}

          <div className="flex flex-col gap-1">
            <Label htmlFor="add-product-code">Supplier code</Label>
            <Input
              id="add-product-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="add-product-title">Supplier product name</Label>
            <Input
              id="add-product-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="add-product-cost">Unit cost</Label>
            <Input
              id="add-product-cost"
              type="number"
              min={0}
              step="0.01"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
          </div>

          {error && <Text className="text-ui-fg-error">{error}</Text>}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Drawer.Close>
          <Button
            type="button"
            isLoading={create.isPending}
            disabled={create.isPending}
            onClick={handleSave}
          >
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
