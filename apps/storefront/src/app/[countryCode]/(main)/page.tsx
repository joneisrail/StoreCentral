import { Metadata } from "next"
import { Suspense } from "react"

import { homepageContent } from "@lib/content/homepage"
import { getStoreName } from "@lib/util/store-name"
import Hero from "@modules/home/components/hero"
import HomeSections from "@modules/home/templates/home-sections"
import { ProductSectionSkeleton } from "@modules/home/templates/home-skeleton"

export function generateMetadata(): Metadata {
  return {
    title: getStoreName(),
    description: homepageContent.description,
  }
}

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  return (
    <>
      <Hero content={homepageContent.hero} />
      <Suspense fallback={<ProductSectionSkeleton />}>
        <HomeSections countryCode={countryCode} />
      </Suspense>
    </>
  )
}
