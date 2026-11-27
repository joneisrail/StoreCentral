"use client"

import { useRef, useState } from "react"
import { loadMore } from "@lib/data/review-actions"
import type { PublicReviewDto, ReviewsPage } from "@lib/data/reviews"
import { Button } from "@modules/common/components/ui"
import Stars from "./stars"

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })

const ReviewList = ({
  productId,
  initial,
}: {
  productId: string
  initial: ReviewsPage
}) => {
  const [reviews, setReviews] = useState<PublicReviewDto[]>(initial.reviews)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const count = initial.count

  const onMore = async () => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setPending(true)
    setFailed(false)
    try {
      const res = await loadMore(productId, reviews.length)
      if (res.ok) {
        setReviews((prev) => [...prev, ...res.page.reviews])
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col divide-y divide-line">
        {reviews.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-6 first:pt-0">
            <div className="flex items-center gap-2">
              <Stars value={r.rating} />
              <span className="sr-only">{`${r.rating} out of 5`}</span>
            </div>
            <h3 className="font-serif text-lg text-charcoal">{r.title}</h3>
            <p className="whitespace-pre-line text-sm text-charcoal">
              {r.comment}
            </p>
            <p className="text-sm text-warm-grey">
              {r.author}
              {" · "}
              <time dateTime={r.created_at}>{formatDate(r.created_at)}</time>
            </p>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-charcoal">
          Couldn&apos;t load more reviews. Please try again.
        </p>
      )}
      {reviews.length < count && (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onMore}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

export default ReviewList
