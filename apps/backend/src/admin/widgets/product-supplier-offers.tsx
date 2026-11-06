import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { useQuery } from "@tanstack/react-query"
import { Badge, Button, Container, Heading, Table, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { sdk } from "../lib/sdk"
import { formatUsd } from "../routes/purchases/format"

type Offer = {
  supplier_product_id: string
  supplier: {
    id: string
    name: string
    is_active: boolean
    lead_time_days: number | null
    payment_terms: string | null
  }
  supplier_sku: string
  supplier_title: string | null
  unit_cost: number | null
  is_lowest: boolean
}

type VariantOffers = {
  variant_id: string
  title: string | null
  sku: string | null
  offers: Offer[]
}

type OffersResponse = { variants: VariantOffers[] }

const ProductSupplierOffers = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["admin", "supplier-offers", data.id],
    queryFn: () =>
      sdk.client.fetch<OffersResponse>("/admin/supplier-offers", {
        query: { product_id: data.id },
      }),
  })

  return (
    <Container>
      <Heading level="h2">Suppliers</Heading>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading supplier offers.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {result?.variants.map((variant) => (
        <div key={variant.variant_id} className="pt-4">
          <Text weight="plus">
            {[variant.title, variant.sku].filter(Boolean).join(" - ") ||
              variant.variant_id}
          </Text>

          {variant.offers.length === 0 ? (
            <div>
              <Text>No supplier offers yet</Text>
              <Text size="small" className="text-ui-fg-subtle">
                Add this variant on a supplier&apos;s Products tab.
              </Text>
            </div>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Supplier</Table.HeaderCell>
                  <Table.HeaderCell>Supplier code</Table.HeaderCell>
                  <Table.HeaderCell>Supplier name</Table.HeaderCell>
                  <Table.HeaderCell>Price</Table.HeaderCell>
                  <Table.HeaderCell>Lead time</Table.HeaderCell>
                  <Table.HeaderCell>Payment terms</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {variant.offers.map((offer) => (
                  <Table.Row
                    key={offer.supplier_product_id}
                    className={
                      offer.supplier.is_active ? undefined : "opacity-60"
                    }
                  >
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/suppliers/${offer.supplier.id}`}
                          className="text-ui-fg-interactive"
                        >
                          {offer.supplier.name}
                        </Link>
                        {!offer.supplier.is_active && (
                          <Badge size="2xsmall" color="grey">
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>{offer.supplier_sku}</Table.Cell>
                    <Table.Cell>{offer.supplier_title ?? "—"}</Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        {offer.unit_cost === null
                          ? "—"
                          : formatUsd(offer.unit_cost)}
                        {offer.is_lowest && (
                          <Badge size="2xsmall" color="green">
                            Lowest
                          </Badge>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {offer.supplier.lead_time_days === null
                        ? "—"
                        : `${offer.supplier.lead_time_days} days`}
                    </Table.Cell>
                    <Table.Cell>
                      {offer.supplier.payment_terms ?? "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
      ))}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductSupplierOffers
