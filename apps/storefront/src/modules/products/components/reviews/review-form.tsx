"use client"

import { useRef, useState, type FormEvent } from "react"
import { createReview } from "@lib/data/review-actions"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Button } from "@modules/common/components/ui"

const fieldClass =
  "w-full rounded-base border border-line-strong bg-paper px-3 py-2 text-sm text-charcoal placeholder:text-warm-grey focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"

type Errors = { rating?: string; title?: string; comment?: string }

const ReviewForm = ({
  productId,
  signedIn,
}: {
  productId: string
  signedIn: boolean
}) => {
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState("")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  if (!signedIn) {
    return (
      <LocalizedClientLink
        href="/account"
        className="inline-flex min-h-[44px] items-center text-sm font-medium text-gold-deep underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"
      >
        Sign in to write a review
      </LocalizedClientLink>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlight.current) {
      return
    }
    const next: Errors = {}
    if (rating < 1) next.rating = "Choose a rating"
    if (!title.trim()) next.title = "Add a title"
    if (!comment.trim()) next.comment = "Add a comment"
    setErrors(next)
    setServerError(null)
    setDone(false)
    if (Object.keys(next).length > 0) {
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      const res = await createReview({
        productId,
        rating,
        title: title.trim(),
        comment: comment.trim(),
      })
      if (res.ok) {
        setDone(true)
        setRating(0)
        setTitle("")
        setComment("")
      } else {
        setServerError(res.error)
      }
    } catch {
      setServerError("Couldn't submit your review. Please try again.")
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <fieldset
        className="flex flex-col gap-1"
        aria-invalid={errors.rating ? true : undefined}
        aria-describedby={errors.rating ? "review-rating-error" : undefined}
      >
        <legend className="text-sm font-medium text-charcoal">Rating</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-1 rounded-base border border-line-strong bg-paper px-2 text-sm text-charcoal has-[:checked]:bg-charcoal has-[:checked]:text-ivory has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-deep"
            >
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
              />
              <span aria-hidden="true">{n}</span>
              <span className="sr-only">{`${n} out of 5`}</span>
            </label>
          ))}
        </div>
        {errors.rating && (
          <p id="review-rating-error" role="alert" className="text-sm text-charcoal">
            {errors.rating}
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="review-title" className="text-sm font-medium text-charcoal">
          Title
        </label>
        <input
          id="review-title"
          name="title"
          type="text"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "review-title-error" : undefined}
          className={fieldClass}
        />
        {errors.title && (
          <p id="review-title-error" role="alert" className="text-sm text-charcoal">
            {errors.title}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="review-comment" className="text-sm font-medium text-charcoal">
          Comment
        </label>
        <textarea
          id="review-comment"
          name="comment"
          rows={5}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-invalid={errors.comment ? true : undefined}
          aria-describedby={errors.comment ? "review-comment-error" : undefined}
          className={fieldClass}
        />
        {errors.comment && (
          <p id="review-comment-error" role="alert" className="text-sm text-charcoal">
            {errors.comment}
          </p>
        )}
      </div>
      {serverError && (
        <p role="alert" className="text-sm text-charcoal">
          {serverError}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-charcoal">
          Thanks, your review is awaiting approval
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          Submit review
        </Button>
      </div>
    </form>
  )
}

export default ReviewForm
