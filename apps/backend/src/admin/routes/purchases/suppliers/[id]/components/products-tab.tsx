import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Table,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { sdk } from "../../../../../lib/sdk"
import type { SupplierProductRow } from "../../types"
import { AddProductDialog } from "./add-product-dialog"

type ProductsResponse = {
  supplier_products: SupplierProductRow[]
  count: number
  limit: number
  offset: number
}

const LIMIT = 20

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function EditProductDialog({
  supplierId,
  row,
  onClose,
}: {
  supplierId: string
  row: SupplierProductRow
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState(row.supplier_sku)
  const [title, setTitle] = useState(row.supplier_title ?? "")
  const [cost, setCost] = useState(
    row.unit_cost === null ? "" : String(row.unit_cost)
  )
  const [error, setError] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch(`/admin/suppliers/${supplierId}/products/${row.id}`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      toast.success("Product updated")
      queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] })
      onClose()
    },
    onError: (err: unknown) => {
      setError(errorMessage(err, "Failed to save the product."))
    },
  })

  const handleSave = () => {
    setError(null)
    if (!code.trim()) {
      setError("Supplier code is required.")
      return
    }

    const body: Record<string, unknown> = {}
    if (code.trim() !== row.supplier_sku) {
      body.supplier_sku = code.trim()
    }
    if (title.trim() !== (row.supplier_title ?? "")) {
      body.supplier_title = title.trim() === "" ? null : title.trim()
    }
    if (cost.trim() !== (row.unit_cost === null ? "" : String(row.unit_cost))) {
      if (cost.trim() === "") {
        body.unit_cost = null
      } else {
        const parsed = Number(cost)
        if (!Number.isFinite(parsed) || parsed < 0) {
          setError("Unit cost must be a number of 0 or more.")
          return
        }
        body.unit_cost = parsed
      }
    }

    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    update.mutate(body)
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit product</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-product-code">Supplier code</Label>
            <Input
              id="edit-product-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-product-title">Supplier product name</Label>
            <Input
              id="edit-product-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-product-cost">Unit cost</Label>
            <Input
              id="edit-product-cost"
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
            isLoading={update.isPending}
            disabled={update.isPending}
            onClick={handleSave}
          >
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const ProductsTab = ({ supplierId }: { supplierId: string }) => {
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const [q, setQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<SupplierProductRow | null>(null)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "suppliers", "products", supplierId, q, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (q) {
        query.q = q
      }
      return sdk.client.fetch<ProductsResponse>(
        `/admin/suppliers/${supplierId}/products`,
        { query }
      )
    },
  })

  const unlink = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/suppliers/${supplierId}/products/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Product unlinked")
      queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] })
    },
    onError: (error: unknown) => {
      const message = errorMessage(error, "Failed to unlink the product.")
      setUnlinkError(message)
      toast.error(message)
    },
  })

  const handleUnlink = async (row: SupplierProductRow) => {
    setUnlinkError(null)
    const confirmed = await prompt({
      title: "Unlink product",
      description: `Unlink ${row.supplier_sku} from this supplier? The product itself is not deleted.`,
      confirmText: "Unlink",
      cancelText: "Cancel",
    })
    if (confirmed) {
      unlink.mutate(row.id)
    }
  }

  const handleSearch = (value: string) => {
    setQ(value)
    setOffset(0)
  }

  const rows = data?.supplier_products ?? []

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h2">Products</Heading>
        <Button size="small" onClick={() => setAdding(true)}>
          Add product
        </Button>
      </div>

      <div className="py-4">
        <Input
          type="search"
          placeholder="Search products"
          value={q}
          onChange={(event) => handleSearch(event.target.value)}
        />
      </div>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading products.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {unlinkError && <Text className="text-ui-fg-error">{unlinkError}</Text>}

      {data && rows.length === 0 && (
        <Text>{q ? "No products found" : "No products linked yet."}</Text>
      )}

      {data && rows.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Supplier code</Table.HeaderCell>
              <Table.HeaderCell>Supplier name</Table.HeaderCell>
              <Table.HeaderCell>Our product</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>Cost</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell>{row.supplier_sku}</Table.Cell>
                <Table.Cell>{row.supplier_title ?? "—"}</Table.Cell>
                <Table.Cell>
                  {row.variant
                    ? [row.variant.product?.title, row.variant.title]
                        .filter(Boolean)
                        .join(" - ") || "—"
                    : "Product removed from catalog"}
                </Table.Cell>
                <Table.Cell>{row.variant?.sku ?? "—"}</Table.Cell>
                <Table.Cell>
                  {row.unit_cost === null ? "—" : row.unit_cost.toFixed(2)}
                </Table.Cell>
                <Table.Cell>
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      aria-label={`Edit ${row.supplier_sku}`}
                      onClick={() => setEditing(row)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      variant="danger"
                      aria-label={`Unlink ${row.supplier_sku}`}
                      disabled={unlink.isPending && unlink.variables === row.id}
                      onClick={() => handleUnlink(row)}
                    >
                      Unlink
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {data && (
        <div className="flex gap-2 pt-4">
          <Button
            size="small"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={offset + LIMIT >= data.count}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next
          </Button>
        </div>
      )}

      {adding && (
        <AddProductDialog
          supplierId={supplierId}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <EditProductDialog
          supplierId={supplierId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Container>
  )
}
