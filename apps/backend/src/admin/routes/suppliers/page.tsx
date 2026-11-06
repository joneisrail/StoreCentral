import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Link } from "react-router-dom"
import { sdk } from "../../lib/sdk"
import type { Supplier } from "./types"

type SuppliersResponse = {
  suppliers: Supplier[]
  count: number
  offset: number
  limit: number
}

type FormValues = {
  name: string
  email: string
  phone: string
  contact_name: string
  website: string
  tax_id: string
  payment_terms: string
  lead_time_days: string
  address: string
  notes: string
}

type FormField = keyof FormValues

type StatusFilter = "all" | "true" | "false"

const LIMIT = 20

const FORM_FIELDS: { key: FormField; label: string; multiline?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "contact_name", label: "Contact name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "tax_id", label: "Tax ID" },
  { key: "payment_terms", label: "Payment terms" },
  { key: "lead_time_days", label: "Lead time (days)" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes", multiline: true },
]

const EMPTY_FORM: FormValues = {
  name: "",
  email: "",
  phone: "",
  contact_name: "",
  website: "",
  tax_id: "",
  payment_terms: "",
  lead_time_days: "",
  address: "",
  notes: "",
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

const SuppliersPage = () => {
  const [q, setQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState<StatusFilter>("all")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<FormValues>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const prompt = usePrompt()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "suppliers", q, offset, status],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (q) {
        query.q = q
      }
      if (status !== "all") {
        query.is_active = status
      }
      return sdk.client.fetch<SuppliersResponse>("/admin/suppliers", { query })
    },
  })

  const invalidateSuppliers = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] })

  const saveSupplier = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch("/admin/suppliers", { method: "POST", body }),
    onSuccess: () => {
      toast.success("Supplier created")
      setDrawerOpen(false)
      invalidateSuppliers()
    },
    onError: (error: unknown) => {
      setFormError(errorMessage(error, "Failed to save the supplier."))
    },
  })

  const deleteSupplier = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/suppliers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Supplier deleted")
      invalidateSuppliers()
    },
    onError: (error: unknown) => {
      const message = errorMessage(error, "Failed to delete the supplier.")
      setDeleteError(message)
      toast.error(message)
    },
  })

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setDrawerOpen(true)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    if (!form.name.trim()) {
      setFormError("Name is required.")
      return
    }

    // Only send the fields that were filled in.
    const body: Record<string, unknown> = {}
    for (const { key } of FORM_FIELDS) {
      const value = form[key].trim()
      if (!value) {
        continue
      }
      if (key === "lead_time_days") {
        const days = Number(value)
        if (!Number.isInteger(days) || days < 0) {
          setFormError("Lead time must be a whole number of days.")
          return
        }
        body[key] = days
      } else {
        body[key] = value
      }
    }

    saveSupplier.mutate(body)
  }

  const handleDelete = async (supplier: Supplier) => {
    setDeleteError(null)
    const confirmed = await prompt({
      title: "Delete supplier",
      description: `Are you sure you want to delete ${supplier.name}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (confirmed) {
      deleteSupplier.mutate(supplier.id)
    }
  }

  const handleSearch = (value: string) => {
    setQ(value)
    setOffset(0)
  }

  const handleStatus = (value: string) => {
    setStatus(value as StatusFilter)
    setOffset(0)
  }

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Suppliers</Heading>
        <Button size="small" onClick={openCreate}>
          Create supplier
        </Button>
      </div>

      <div className="flex items-center gap-2 py-4">
        <Input
          type="search"
          placeholder="Search suppliers"
          value={q}
          onChange={(event) => handleSearch(event.target.value)}
        />
        <Label htmlFor="supplier-status-filter">Status</Label>
        <select
          id="supplier-status-filter"
          className="bg-ui-bg-field text-ui-fg-base shadow-borders-base rounded-md px-2 py-1.5 text-sm"
          value={status}
          onChange={(event) => handleStatus(event.target.value)}
        >
          <option value="all">All</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading suppliers.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {deleteError && <Text className="text-ui-fg-error">{deleteError}</Text>}

      {!isLoading && !isError && data && data.suppliers.length === 0 && (
        <Text>{q ? "No suppliers match your search." : "No suppliers yet."}</Text>
      )}

      {!isLoading && !isError && data && data.suppliers.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Phone</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.suppliers.map((supplier) => (
              <Table.Row key={supplier.id}>
                <Table.Cell>
                  <div className="flex items-center gap-2">
                    <Link to={`/suppliers/${supplier.id}`}>{supplier.name}</Link>
                    {!supplier.is_active && <Badge color="grey">Inactive</Badge>}
                  </div>
                </Table.Cell>
                <Table.Cell>{supplier.email ?? "—"}</Table.Cell>
                <Table.Cell>{supplier.phone ?? "—"}</Table.Cell>
                <Table.Cell>
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      variant="danger"
                      disabled={
                        deleteSupplier.isPending &&
                        deleteSupplier.variables === supplier.id
                      }
                      onClick={() => handleDelete(supplier)}
                    >
                      Delete
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {/* Rendered whenever a result set exists, even on an empty page, so
          deleting the last row on page 2+ never strands the user. */}
      {!isLoading && !isError && data && (
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

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content>
          <form onSubmit={handleSubmit} className="flex h-full flex-col">
            <Drawer.Header>
              <Drawer.Title>
                Create supplier
              </Drawer.Title>
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-4">
              {FORM_FIELDS.map(({ key, label, multiline }) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`supplier-${key}`}>{label}</Label>
                  {multiline ? (
                    <Textarea
                      id={`supplier-${key}`}
                      value={form[key]}
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                  ) : (
                    <Input
                      id={`supplier-${key}`}
                      value={form[key]}
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                  )}
                </div>
              ))}
              {formError && <Text className="text-ui-fg-error">{formError}</Text>}
            </Drawer.Body>
            <Drawer.Footer>
              <Drawer.Close asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Drawer.Close>
              <Button
                type="submit"
                isLoading={saveSupplier.isPending}
                disabled={saveSupplier.isPending}
              >
                Save
              </Button>
            </Drawer.Footer>
          </form>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Suppliers",
})

export default SuppliersPage
