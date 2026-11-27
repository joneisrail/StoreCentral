import { retrieveCustomer } from "@lib/data/customer"
import { listReviews } from "@lib/data/reviews"
import ReviewForm from "./review-form"
import ReviewList from "./review-list"
import ReviewSummary from "./review-summary"

const ProductReviews = async ({ productId }: { productId: string }) => {
  const [page, customer] = await Promise.all([
    listReviews(productId),
    retrieveCustomer().catch(() => null),
  ])

  return (
    <section aria-labelledby="reviews-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 id="reviews-heading" className="font-serif text-2xl text-charcoal">
          Customer reviews
        </h2>
        {page && <ReviewSummary average={page.average} count={page.count} />}
      </div>
      {page ? (
        <>
          {page.count > 0 ? (
            <ReviewList productId={productId} initial={page} />
          ) : (
            <p className="text-sm text-warm-grey">No reviews yet.</p>
          )}
          <ReviewForm productId={productId} signedIn={!!customer} />
        </>
      ) : (
        <p className="text-sm text-warm-grey">Reviews are unavailable right now</p>
      )}
    </section>
  )
}

export default ProductReviews
