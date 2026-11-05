import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
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
import { sdk } from "../../lib/sdk"

type Supplier = {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  created_at: string
}

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
  address: string
  notes: string
}

type FormField = keyof FormValues

const LIMIT = 20

const FORM_FIELDS: { key: FormField; label: string; multiline?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes", multiline: true },
]

const EMPTY_FORM: FormValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
}

function toFormValues(supplier: Supplier): FormValues {
  return {
    name: supplier.name,
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    address: supplier.address ?? "",
    notes: supplier.notes ?? "",
  }
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<FormValues>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const prompt = usePrompt()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "suppliers", q, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (q) {
        query.q = q
      }
      return sdk.client.fetch<SuppliersResponse>("/admin/suppliers", { query })
    },
  })

  const invalidateSuppliers = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] })

  const saveSupplier = useMutation({
    mutationFn: (body: Partial<FormValues>) =>
      editing
        ? sdk.client.fetch(`/admin/suppliers/${editing.id}`, {
            method: "POST",
            body,
          })
        : sdk.client.fetch("/admin/suppliers", { method: "POST", body }),
    onSuccess: () => {
      toast.success(editing ? "Supplier updated" : "Supplier created")
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
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setDrawerOpen(true)
  }

  const openEdit = (supplier: Supplier) => {
    setEditing(supplier)
    setForm(toFormValues(supplier))
    setFormError(null)
    setDrawerOpen(true)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    const values: FormValues = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
    }

    if (!values.name) {
      setFormError("Name is required.")
      return
    }

    const body: Partial<FormValues> = {}
    if (editing) {
      // Only send the fields that changed.
      const original = toFormValues(editing)
      for (const { key } of FORM_FIELDS) {
        if (values[key] !== original[key]) {
          body[key] = values[key]
        }
      }
      if (Object.keys(body).length === 0) {
        setDrawerOpen(false)
        return
      }
    } else {
      // Only send the fields that were filled in.
      for (const { key } of FORM_FIELDS) {
        if (values[key]) {
          body[key] = values[key]
        }
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

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Suppliers</Heading>
        <Button size="small" onClick={openCreate}>
          Create supplier
        </Button>
      </div>

      <div className="py-4">
        <Input
          type="search"
          placeholder="Search suppliers"
          value={q}
          onChange={(event) => handleSearch(event.target.value)}
        />
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
                <Table.Cell>{supplier.name}</Table.Cell>
                <Table.Cell>{supplier.email ?? "—"}</Table.Cell>
                <Table.Cell>{supplier.phone ?? "—"}</Table.Cell>
                <Table.Cell>
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => openEdit(supplier)}
                    >
                      Edit
                    </Button>
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
                {editing ? "Edit supplier" : "Create supplier"}
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
