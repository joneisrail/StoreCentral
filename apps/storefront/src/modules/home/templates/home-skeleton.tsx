import {
  Skeleton,
  SkeletonImage,
  SkeletonText,
} from "@modules/common/components/skeleton"

// Heights mirror product-section/index.tsx and product-preview:
// - header row: View all link is min-h-[44px] below lg, h2 is text-2xl
//   (32px line) at lg, so the row is h-11 lg:h-8, with the same mb-8
// - card: 4/5 image, mt-4, then a 2-line clamped title (text-base, 24px
//   lines = 48px), gap-y-1 (4px) and a price line (24px)
// - eight cards in the same grid (the section fetches up to 8 products)
export const ProductSectionSkeleton = () => (
  <section
    className="content-container py-12 small:py-24"
    data-testid="product-section-skeleton"
  >
    <div className="mb-8 flex h-11 items-center justify-between gap-4 lg:h-8">
      <Skeleton className="h-6 w-48" />
    </div>
    <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="min-w-0" data-testid="product-card-skeleton">
          <SkeletonImage ratio="4/5" />
          <div className="mt-4 flex min-w-0 flex-col gap-y-1">
            <div className="h-12">
              <SkeletonText lines={2} />
            </div>
            <div className="flex h-6 items-center">
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
)

// Mirrors category-grid / brand-strip: h2 (32px) + mb-8, tiles with a 4/3
// image and a label row (py-4 around a 28px text-lg line = 60px) inside a
// 1px border.
export const TileSkeleton = ({
  variant = "category",
}: {
  variant?: "category" | "brand"
}) => (
  <section
    className="content-container py-12 small:py-24"
    data-testid="tile-skeleton"
  >
    <div className="mb-8 flex h-8 items-center">
      <Skeleton className="h-6 w-48" />
    </div>
    <div
      className={
        variant === "brand"
          ? "grid grid-cols-2 gap-4 small:grid-cols-4 lg:grid-cols-6"
          : "grid grid-cols-2 gap-4 small:grid-cols-3 lg:grid-cols-4"
      }
    >
      {Array.from({ length: variant === "brand" ? 6 : 4 }, (_, i) => (
        <div
          key={i}
          className="min-w-0 overflow-hidden rounded-soft border border-line"
        >
          <div className="aspect-[4/3] w-full">
            <Skeleton className="h-full w-full" />
          </div>
          <div className="flex h-[60px] items-center justify-center px-4">
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  </section>
)
