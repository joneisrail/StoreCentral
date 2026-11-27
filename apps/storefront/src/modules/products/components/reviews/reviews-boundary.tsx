"use client"

import { Component, ReactNode } from "react"

type Props = { children: ReactNode }
type State = { failed: boolean }

/**
 * Keeps the product page rendering when the reviews section throws.
 * The null-data case is handled inside ProductReviews itself.
 */
export default class ReviewsBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <section aria-labelledby="reviews-heading" className="flex flex-col gap-6">
          <h2 id="reviews-heading" className="font-serif text-2xl text-charcoal">
            Customer reviews
          </h2>
          <p className="text-sm text-warm-grey">
            Reviews are unavailable right now
          </p>
        </section>
      )
    }
    return this.props.children
  }
}
