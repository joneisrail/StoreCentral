import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Container,
  Input,
  Label,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { sdk } from "../../../../lib/sdk"
import type { Supplier } from "../../types"

type TextField =
  | "name"
  | "email"
  | "phone"
  | "contact_name"
  | "website"
  | "tax_id"
  | "payment_terms"
  | "address"
  | "notes"

type FormValues = Record<TextField, string> & { lead_time_days: string }

const TEXT_FIELDS: { key: TextField; label: string; multiline?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "contact_name", label: "Contact name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "tax_id", label: "Tax ID" },
  { key: "payment_terms", label: "Payment terms" },
  { key: "address", label: "Address", multiline: true },
  { key: "notes", label: "Notes", multiline: true },
]

function toFormValues(supplier: Supplier): FormValues {
  return {
    name: supplier.name,
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    contact_name: supplier.contact_name ?? "",
    website: supplier.website ?? "",
    tax_id: supplier.tax_id ?? "",
    payment_terms: supplier.payment_terms ?? "",
    address: supplier.address ?? "",
    notes: supplier.notes ?? "",
    lead_time_days:
      supplier.lead_time_days === null ? "" : String(supplier.lead_time_days),
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export const DetailsTab = ({ supplier }: { supplier: Supplier }) => {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormValues>(() => toFormValues(supplier))
  const [error, setError] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ supplier: Supplier }>(`/admin/suppliers/${supplier.id}`, {
        method: "POST",
        body,
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast.success("Supplier updated")
      queryClient.invalidateQueries({ queryKey: ["admin", "suppliers"] })
    },
    onError: (err: unknown) => {
      const message = errorMessage(err, "Failed to save the supplier.")
      setError(message)
      toast.error(message)
    },
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const original = toFormValues(supplier)
    if (!form.name.trim()) {
      setError("Name is required.")
      return
    }

    const body: Record<string, unknown> = {}
    for (const { key } of TEXT_FIELDS) {
      const value = form[key].trim()
      if (value !== original[key]) {
        // Optional fields are cleared with null; name can never be empty.
        body[key] = value === "" ? null : value
      }
    }

    const lead = form.lead_time_days.trim()
    if (lead !== original.lead_time_days) {
      if (lead === "") {
        body.lead_time_days = null
      } else {
        const parsed = Number(lead)
        if (!Number.isInteger(parsed) || parsed < 0) {
          setError("Lead time must be a whole number of days.")
          return
        }
        body.lead_time_days = parsed
      }
    }

    if (Object.keys(body).length === 0) {
      return
    }
    // Reset to the saved values; the Active switch never touches the form,
    // so unsaved text edits survive a toggle.
    update.mutate(body, {
      onSuccess: (result) => setForm(toFormValues(result.supplier)),
    })
  }

  return (
    <Container>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch
            id="supplier-is_active"
            checked={supplier.is_active}
            disabled={update.isPending}
            onCheckedChange={(checked) => update.mutate({ is_active: checked })}
          />
          <Label htmlFor="supplier-is_active">Active</Label>
        </div>

        {TEXT_FIELDS.map(({ key, label, multiline }) => (
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

        <div className="flex flex-col gap-1">
          <Label htmlFor="supplier-lead_time_days">Lead time (days)</Label>
          <Input
            id="supplier-lead_time_days"
            type="number"
            min={0}
            value={form.lead_time_days}
            onChange={(event) =>
              setForm({ ...form, lead_time_days: event.target.value })
            }
          />
        </div>

        {error && <Text className="text-ui-fg-error">{error}</Text>}

        <div>
          <Button
            type="submit"
            isLoading={update.isPending}
            disabled={update.isPending}
          >
            Save
          </Button>
        </div>
      </form>
    </Container>
  )
}
