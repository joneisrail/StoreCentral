import { Skeleton, SkeletonImage } from "@modules/common/components/skeleton"

export const ProductSectionSkeleton = () => (
  <section
    className="content-container py-12 small:py-24"
    data-testid="product-section-skeleton"
  >
    <div className="mb-8 flex items-baseline justify-between gap-4">
      <Skeleton className="h-8 w-48" />
    </div>
    <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <SkeletonImage key={i} />
      ))}
    </div>
  </section>
)

export const TileSkeleton = () => (
  <section
    className="content-container py-12 small:py-24"
    data-testid="tile-skeleton"
  >
    <Skeleton className="mb-8 h-8 w-48" />
    <div className="grid grid-cols-2 gap-4 small:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <SkeletonImage key={i} ratio="1/1" />
      ))}
    </div>
  </section>
)
