import { Suspense } from "react"

import { getNewsletterAction, homepageContent } from "@lib/content/homepage"
import type { ResolvedSection } from "@lib/content/homepage-sections"
import {
  getHomepageSections,
  listBrandTiles,
  listSectionProducts,
  listShopTiles,
} from "@lib/data/homepage"
import BrandStrip from "@modules/home/components/brand-strip"
import CategoryGrid from "@modules/home/components/category-grid"
import Editorial from "@modules/home/components/editorial"
import Newsletter from "@modules/home/components/newsletter"
import ProductSection from "@modules/home/components/product-section"
import PromoBanners from "@modules/home/components/promo-banners"

import { ProductSectionSkeleton, TileSkeleton } from "./home-skeleton"

const ShopTiles = async () => (
  <CategoryGrid categories={await listShopTiles()} />
)

const BrandTiles = async () => <BrandStrip brands={await listBrandTiles()} />

export const SectionProducts = async ({
  section,
  regionId,
}: {
  section: ResolvedSection
  regionId: string
}) => {
  const products = await listSectionProducts(section, regionId)
  return (
    <ProductSection
      title={section.title}
      viewAllHref={
        section.kind === "latest"
          ? "/store"
          : `/collections/${section.collection.handle}`
      }
      products={products}
    />
  )
}

export const ProductSections = async ({
  countryCode,
}: {
  countryCode: string
}) => {
  const data = await getHomepageSections(countryCode)
  if (!data) {
    return null
  }
  const { region, sections } = data

  return (
    <>
      {sections.map((section) => (
        <Suspense
          key={`section:${section.id}`}
          fallback={<ProductSectionSkeleton />}
        >
          <SectionProducts section={section} regionId={region.id} />
        </Suspense>
      ))}
    </>
  )
}

// Category, brand and static blocks never wait on region or collections:
// the product sections sit in their own Suspense and render nothing when
// that lookup fails.
const HomeSections = ({ countryCode }: { countryCode: string }) => (
  <>
    <Suspense key="categories" fallback={<TileSkeleton />}>
      <ShopTiles />
    </Suspense>
    <Suspense key="brands" fallback={<TileSkeleton variant="brand" />}>
      <BrandTiles />
    </Suspense>
    <Suspense key="products" fallback={<ProductSectionSkeleton />}>
      <ProductSections countryCode={countryCode} />
    </Suspense>
    <PromoBanners key="promos" promos={homepageContent.promos} />
    <Editorial key="editorial" blocks={homepageContent.editorial} />
    <Newsletter key="newsletter" action={getNewsletterAction()} />
  </>
)

export default HomeSections
