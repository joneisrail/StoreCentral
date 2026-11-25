import type { TileCategory } from "@lib/data/homepage"
import { Heading } from "@modules/common/components/ui"

import Reveal from "../reveal"
import Tile from "./tile"

const CategoryGrid = ({ categories }: { categories: TileCategory[] }) => {
  if (!categories.length) {
    return null
  }

  return (
    <Reveal>
      <section className="content-container py-12 small:py-24">
        <Heading level="h2" className="mb-8">
          Shop by category
        </Heading>
        <ul className="grid grid-cols-2 gap-4 small:grid-cols-3 lg:grid-cols-4">
          {categories.map((category) => (
            <li key={category.id} className="min-w-0">
              <Tile tile={category} />
            </li>
          ))}
        </ul>
      </section>
    </Reveal>
  )
}

export default CategoryGrid
