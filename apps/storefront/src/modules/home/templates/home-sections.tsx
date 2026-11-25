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

export type PlannedBlock =
  | { key: "categories" | "brands" | "promos" | "editorial" | "newsletter" }
  | { key: `section:${string}`; section: ResolvedSection }

// Pure ordering of the homepage blocks below the hero.
export const planHomeSections = (
  sections: ResolvedSection[]
): PlannedBlock[] => [
  { key: "categories" },
  { key: "brands" },
  ...sections.map(
    (section): PlannedBlock => ({ key: `section:${section.id}`, section })
  ),
  { key: "promos" },
  { key: "editorial" },
  { key: "newsletter" },
]

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

const HomeSections = async ({ countryCode }: { countryCode: string }) => {
  const data = await getHomepageSections(countryCode)
  if (!data) {
    return null
  }
  const { region, sections } = data

  return (
    <>
      {planHomeSections(sections).map((block) => {
        switch (block.key) {
          case "categories":
            return (
              <Suspense key={block.key} fallback={<TileSkeleton />}>
                <ShopTiles />
              </Suspense>
            )
          case "brands":
            return (
              <Suspense key={block.key} fallback={<TileSkeleton />}>
                <BrandTiles />
              </Suspense>
            )
          case "promos":
            return <PromoBanners key={block.key} promos={homepageContent.promos} />
          case "editorial":
            return (
              <Editorial key={block.key} blocks={homepageContent.editorial} />
            )
          case "newsletter":
            return (
              <Newsletter key={block.key} action={getNewsletterAction()} />
            )
          default:
            return "section" in block ? (
              <Suspense key={block.key} fallback={<ProductSectionSkeleton />}>
                <SectionProducts section={block.section} regionId={region.id} />
              </Suspense>
            ) : null
        }
      })}
    </>
  )
}

export default HomeSections
