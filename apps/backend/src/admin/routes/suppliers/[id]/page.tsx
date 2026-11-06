import { useQuery } from "@tanstack/react-query"
import { Badge, Button, Container, Heading, Tabs, Text } from "@medusajs/ui"
import { Link, useParams } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import type { Supplier } from "../types"
import { DetailsTab } from "./components/details-tab"
import { ProductsTab } from "./components/products-tab"
import { PurchasesTab } from "./components/purchases-tab"

type SupplierResponse = { supplier: Supplier }

const SupplierDetailPage = () => {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "suppliers", "detail", id],
    queryFn: () => sdk.client.fetch<SupplierResponse>(`/admin/suppliers/${id}`),
  })

  if (isLoading) {
    return (
      <Container>
        <Text>Loading...</Text>
      </Container>
    )
  }

  if (isError && (error as { status?: number } | null)?.status === 404) {
    return (
      <Container>
        <Text>Supplier not found</Text>
        <Link to="/suppliers">Back to suppliers</Link>
      </Container>
    )
  }

  if (isError || !data) {
    return (
      <Container>
        <Text>Something went wrong loading this supplier.</Text>
        <Button size="small" variant="secondary" onClick={() => refetch()}>
          Retry
        </Button>
      </Container>
    )
  }

  const { supplier } = data

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <div className="flex items-center gap-3">
          <Heading level="h1">{supplier.name}</Heading>
          {!supplier.is_active && <Badge color="grey">Inactive</Badge>}
        </div>
        <Link to="/suppliers">
          <Text size="small">Back to suppliers</Text>
        </Link>
      </Container>

      <Tabs defaultValue="details">
        <Tabs.List>
          <Tabs.Trigger value="details">Details</Tabs.Trigger>
          <Tabs.Trigger value="products">Products</Tabs.Trigger>
          <Tabs.Trigger value="purchases">Purchases</Tabs.Trigger>
        </Tabs.List>
        <div className="pt-4">
          <Tabs.Content value="details">
            <DetailsTab key={supplier.id} supplier={supplier} />
          </Tabs.Content>
          <Tabs.Content value="products">
            <ProductsTab supplierId={supplier.id} />
          </Tabs.Content>
          <Tabs.Content value="purchases">
            <PurchasesTab supplierId={supplier.id} />
          </Tabs.Content>
        </div>
      </Tabs>
    </div>
  )
}

export default SupplierDetailPage
