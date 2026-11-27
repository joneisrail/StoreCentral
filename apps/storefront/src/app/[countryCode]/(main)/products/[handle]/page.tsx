import { Metadata } from "next"
import { notFound } from "next/navigation"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { listReviews } from "@lib/data/reviews"
import { toBrandName, toFragranceProfile } from "@lib/util/fragrance-profile"
import { buildDescription } from "@lib/util/product-seo"
import ProductTemplate from "@modules/products/templates"
import { HttpTypes } from "@medusajs/types"
import { getStoreName } from "@lib/util/store-name"

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
  searchParams: Promise<{ v_id?: string }>
}

function getImagesForVariant(
  product: HttpTypes.StoreProduct,
  selectedVariantId?: string,
) {
  if (!selectedVariantId || !product.variants) {
    return product.images
  }

  const variant = product.variants!.find((v) => v.id === selectedVariantId)
  if (!variant || !variant.images?.length) {
    return product.images
  }

  const imageIdsMap = new Map(variant.images!.map((i) => [i.id, true]))
  return product.images?.filter((i) => imageIdsMap.has(i.id)) ?? null
}

/** Href of the brand category (a child of the "brands" category), if any. */
function getBrandHref(product: HttpTypes.StoreProduct): string | null {
  const category = (product.categories ?? []).find(
    (c) => c?.parent_category?.handle === "brands" && Boolean(c.name?.trim()),
  )
  return category?.handle ? `/categories/${category.handle}` : null
}

function getImageUrls(product: HttpTypes.StoreProduct): string[] {
  const urls = (product.images ?? [])
    .map((image) => image.url)
    .filter((url): url is string => Boolean(url))
  if (urls.length > 0) {
    return urls
  }
  return product.thumbnail ? [product.thumbnail] : []
}

async function getProduct(countryCode: string, handle: string) {
  const region = await getRegion(countryCode)

  if (!region) {
    notFound()
  }

  const product = await listProducts({
    countryCode,
    queryParams: { handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  return { region, product }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { countryCode, handle } = await props.params
  const { product } = await getProduct(countryCode, handle)

  const title = `${product.title} | ${getStoreName()}`
  const description = buildDescription({
    brand: toBrandName(product),
    family: toFragranceProfile(product).family,
    description: product.description,
    title: product.title ?? "",
  })
  const images = getImageUrls(product)

  return {
    title,
    description,
    alternates: {
      canonical: `/${countryCode}/products/${handle}`,
    },
    openGraph: {
      type: "website",
      title,
      description,
      images,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  }
}

export default async function ProductPage(props: Props) {
  const params = await props.params
  const searchParams = await props.searchParams

  const selectedVariantId = searchParams.v_id

  const { region, product } = await getProduct(
    params.countryCode,
    params.handle,
  )

  const images = getImagesForVariant(product, selectedVariantId)
  const reviews = await listReviews(product.id)

  return (
    <ProductTemplate
      product={product}
      region={region}
      countryCode={params.countryCode}
      images={images ?? []}
      brand={toBrandName(product)}
      brandHref={getBrandHref(product)}
      shippingNote={process.env.NEXT_PUBLIC_SHIPPING_NOTE}
      returnsNote={process.env.NEXT_PUBLIC_RETURNS_NOTE}
      reviews={reviews}
    />
  )
}
