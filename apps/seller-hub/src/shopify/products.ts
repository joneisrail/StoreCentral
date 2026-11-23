import { PermanentSyncError } from "../queue/queues.js"
import type { ChannelListing } from "../sync/channel-import.js"
import type { ShopifyClient } from "./client.js"

export type ShopifyVariant = {
  variantId: string
  sku: string | null
  inventoryItemId: string
  price: string
}

const VARIANTS_QUERY = `
  query Variants($after: String) {
    productVariants(first: 100, after: $after) {
      nodes { id sku price inventoryItem { id } }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type VariantsData = {
  productVariants: {
    nodes: {
      id: string
      sku: string | null
      price: string
      inventoryItem: { id: string }
    }[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

export const listShopifyVariants = async (
  client: ShopifyClient
): Promise<ShopifyVariant[]> => {
  const out: ShopifyVariant[] = []
  let after: string | null = null
  while (true) {
    const data: VariantsData = await client.graphql<VariantsData>(
      VARIANTS_QUERY,
      { after }
    )
    for (const n of data.productVariants.nodes) {
      out.push({
        variantId: n.id,
        sku: n.sku && n.sku.length > 0 ? n.sku : null,
        inventoryItemId: n.inventoryItem.id,
        price: n.price,
      })
    }
    const { hasNextPage, endCursor } = data.productVariants.pageInfo
    if (!hasNextPage || !endCursor) return out
    after = endCursor
  }
}

const CATALOG_QUERY = `
  query Catalog($after: String) {
    productVariants(first: 100, after: $after) {
      nodes {
        id sku title price inventoryQuantity
        product { id title featuredImage { url } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type CatalogData = {
  productVariants: {
    nodes: {
      id: string
      sku: string | null
      title: string
      price: string
      inventoryQuantity: number | null
      product: {
        id: string
        title: string
        featuredImage: { url: string } | null
      }
    }[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

/** Read-only catalogue (GraphQL query only) for the channel import. */
export const listShopifyCatalog = async (
  client: ShopifyClient
): Promise<ChannelListing[]> => {
  const out: ChannelListing[] = []
  let after: string | null = null
  while (true) {
    const data: CatalogData = await client.graphql<CatalogData>(
      CATALOG_QUERY,
      { after }
    )
    for (const n of data.productVariants.nodes) {
      out.push({
        externalId: n.id,
        parentExternalId: n.product.id,
        sku: n.sku && n.sku.trim().length > 0 ? n.sku : null,
        title: n.title,
        parentTitle: n.product.title,
        price: n.price,
        stock: typeof n.inventoryQuantity === "number" ? n.inventoryQuantity : null,
        imageUrl: n.product.featuredImage?.url ?? null,
        currency: null,
      })
    }
    const { hasNextPage, endCursor } = data.productVariants.pageInfo
    if (!hasNextPage || !endCursor) return out
    after = endCursor
  }
}

const PRODUCT_OF_VARIANT_QUERY = `
  query ProductOfVariant($id: ID!) {
    productVariant(id: $id) { product { id } }
  }
`

const PRICE_MUTATION = `
  mutation UpdatePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`

export const updateShopifyVariantPrice = async (
  client: ShopifyClient,
  input: { productId?: string; variantId: string; price: string }
): Promise<void> => {
  let productId = input.productId
  if (!productId) {
    const found = await client.graphql<{
      productVariant: { product: { id: string } } | null
    }>(PRODUCT_OF_VARIANT_QUERY, { id: input.variantId })
    productId = found.productVariant?.product.id
    if (!productId) {
      throw new PermanentSyncError(
        `Shopify variant ${input.variantId} not found`
      )
    }
  }

  const data = await client.graphql<{
    productVariantsBulkUpdate: {
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(PRICE_MUTATION, {
    productId,
    variants: [{ id: input.variantId, price: input.price }],
  })

  const errors = data.productVariantsBulkUpdate.userErrors
  if (errors.length > 0) {
    throw new PermanentSyncError(
      `Shopify price update rejected: ${errors.map((e) => e.message).join("; ")}`
    )
  }
}
