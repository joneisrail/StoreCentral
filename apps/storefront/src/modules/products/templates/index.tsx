import React, { Suspense } from "react"

import type { ReviewsPage } from "@lib/data/reviews"
import { getBaseURL } from "@lib/util/env"
import { toFragranceProfile } from "@lib/util/fragrance-profile"
import { buildDescription } from "@lib/util/product-seo"
import FragranceProfileSection from "@modules/products/components/fragrance-profile"
import ImageGallery from "@modules/products/components/image-gallery"
import ProductActions from "@modules/products/components/product-actions"
import ProductJsonLd from "@modules/products/components/product-jsonld"
import ProductTabs from "@modules/products/components/product-tabs"
import RecentlyViewed from "@modules/products/components/recently-viewed"
import RelatedProducts from "@modules/products/components/related-products"
import ProductReviews from "@modules/products/components/reviews"
import ReviewSummary from "@modules/products/components/reviews/review-summary"
import ReviewsBoundary from "@modules/products/components/reviews/reviews-boundary"
import ProductInfo, {
  ProductDescription,
} from "@modules/products/templates/product-info"
import SkeletonRelatedProducts from "@modules/skeletons/templates/skeleton-related-products"
import { notFound } from "next/navigation"
import { HttpTypes } from "@medusajs/types"

import ProductActionsWrapper from "./product-actions-wrapper"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
  images: HttpTypes.StoreProductImage[]
  brand: string | null
  brandHref: string | null
  shippingNote?: string
  returnsNote?: string
  /** First page of approved reviews, or null when the reviews route failed. */
  reviews: ReviewsPage | null
}

const ReviewsLoading = () => (
  <div
    className="h-40 w-full animate-pulse bg-paper"
    aria-busy="true"
    aria-label="Loading reviews"
  />
)

const ProductTemplate: React.FC<ProductTemplateProps> = ({
  product,
  region,
  countryCode,
  images,
  brand,
  brandHref,
  shippingNote,
  returnsNote,
  reviews,
}) => {
  if (!product || !product.id) {
    return notFound()
  }

  const profile = toFragranceProfile(product)
  const description = buildDescription({
    brand,
    family: profile.family,
    description: product.description,
    title: product.title ?? "",
  })
  const url = `${getBaseURL()}/${countryCode}/products/${product.handle ?? ""}`

  return (
    <>
      <ProductJsonLd
        product={product}
        url={url}
        brand={brand}
        description={description}
        reviews={reviews}
        currencyCode={region?.currency_code ?? null}
      />
      <div className="content-container py-6" data-testid="product-container">
        <div className="grid grid-cols-1 gap-y-8 small:grid-cols-2 small:items-start small:gap-x-12">
          <div className="w-full">
            <ImageGallery images={images} title={product.title ?? ""} />
          </div>
          <div className="flex flex-col gap-y-8 small:sticky small:top-24">
            <ProductInfo
              product={product}
              brand={brand}
              brandHref={brandHref}
              showDescription={false}
              summary={
                reviews ? (
                  <ReviewSummary
                    average={reviews.average}
                    count={reviews.count}
                  />
                ) : null
              }
            />
            <Suspense
              fallback={
                <ProductActions
                  disabled={true}
                  product={product}
                  region={region}
                />
              }
            >
              <ProductActionsWrapper id={product.id} region={region} />
            </Suspense>
            <ProductDescription product={product} />
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-y-16 small:mt-24">
          <FragranceProfileSection profile={profile} />
          <ProductTabs
            product={product}
            shippingNote={shippingNote}
            returnsNote={returnsNote}
          />
          <ReviewsBoundary>
            <Suspense fallback={<ReviewsLoading />}>
              <ProductReviews productId={product.id} />
            </Suspense>
          </ReviewsBoundary>
        </div>
      </div>
      <div
        className="content-container my-16 small:my-32"
        data-testid="related-products-container"
      >
        <Suspense fallback={<SkeletonRelatedProducts />}>
          <RelatedProducts product={product} countryCode={countryCode} />
        </Suspense>
      </div>
      <div className="content-container mb-16 small:mb-32">
        <RecentlyViewed productId={product.id} countryCode={countryCode} />
      </div>
    </>
  )
}

export default ProductTemplate
