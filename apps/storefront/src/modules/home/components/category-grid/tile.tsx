import type { TileCategory } from "@lib/data/homepage"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

const Tile = ({ tile }: { tile: TileCategory }) => (
  <LocalizedClientLink
    href={`/categories/${tile.handle}`}
    className="group block min-w-0 overflow-hidden rounded-soft border border-line bg-paper transition-colors hover:border-line-strong motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"
  >
    {tile.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={tile.imageUrl}
        alt=""
        loading="lazy"
        className="aspect-[4/3] w-full object-cover"
      />
    ) : null}
    <span className="flex min-h-[44px] min-w-0 items-center justify-center break-words px-4 py-4 text-center font-serif text-lg text-charcoal">
      {tile.name}
    </span>
  </LocalizedClientLink>
)

export default Tile
