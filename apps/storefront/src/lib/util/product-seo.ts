const MAX_DESCRIPTION = 160
const MAX_REVIEWS = 5

const clip = (text: string): string =>
  text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`

export const buildDescription = (input: {
  brand: string | null
  family: string | null
  description: string | null | undefined
  title: string
}): string => {
  const own = input.description?.replace(/\s+/g, " ").trim()
  if (own) {
    return clip(own)
  }

  const parts = [input.brand, input.title].filter(Boolean).join(" ")
  const family = input.family ? ` A ${input.family} fragrance.` : ""
  return clip(`${parts}.${family}`.trim() || input.title)
}

type JsonLdReview = {
  author: string
  rating: number
  title: string
  comment: string
  created_at: string
}

export const buildProductJsonLd = (input: {
  name: string
  url: string
  images: string[]
  description: string
  sku: string | null
  brand: string | null
  price: number | null
  currency: string | null
  inStock: boolean
  rating: { average: number; count: number } | null
  reviews: JsonLdReview[]
}): Record<string, unknown> => {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
    image: input.images,
    description: input.description,
  }

  if (input.sku) {
    data.sku = input.sku
  }
  if (input.brand) {
    data.brand = { "@type": "Brand", name: input.brand }
  }
  if (input.price !== null && input.currency) {
    data.offers = {
      "@type": "Offer",
      url: input.url,
      price: input.price,
      priceCurrency: input.currency.toUpperCase(),
      availability: input.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    }
  }
  if (input.rating) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: input.rating.average,
      reviewCount: input.rating.count,
    }
    data.review = input.reviews.slice(0, MAX_REVIEWS).map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.author },
      datePublished: review.created_at,
      name: review.title,
      reviewBody: review.comment,
      reviewRating: { "@type": "Rating", ratingValue: review.rating },
    }))
  }

  return data
}

/** All product image URLs, falling back to the thumbnail, else empty. */
export const getProductImageUrls = (product: {
  images?: Array<{ url?: string | null } | null> | null
  thumbnail?: string | null
}): string[] => {
  const urls = (product.images ?? [])
    .map((image) => image?.url)
    .filter((url): url is string => Boolean(url))
  if (urls.length > 0) {
    return urls
  }
  return product.thumbnail ? [product.thumbnail] : []
}

export const serializeJsonLd =(data: Record<string, unknown>): string =>
  JSON.stringify(data).replace(/</g, "\\u003c")
