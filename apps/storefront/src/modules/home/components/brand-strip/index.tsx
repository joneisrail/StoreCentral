import type { TileCategory } from "@lib/data/homepage"
import { Heading } from "@modules/common/components/ui"

import Tile from "../category-grid/tile"
import Reveal from "../reveal"

const BrandStrip = ({ brands }: { brands: TileCategory[] }) => {
  if (!brands.length) {
    return null
  }

  return (
    <Reveal>
      <section className="content-container py-12 small:py-24">
        <Heading level="h2" className="mb-8">
          Shop by brand
        </Heading>
        <ul className="grid grid-cols-2 gap-4 small:grid-cols-4 lg:grid-cols-6">
          {brands.map((brand) => (
            <li key={brand.id} className="min-w-0">
              <Tile tile={brand} />
            </li>
          ))}
        </ul>
      </section>
    </Reveal>
  )
}

export default BrandStrip
