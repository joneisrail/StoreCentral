// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import ReviewForm from "./review-form"

const createReview = vi.fn()
vi.mock("@lib/data/review-actions", () => ({
  createReview: (...args: unknown[]) => createReview(...args),
}))

const submitBtn = () =>
  document.querySelector("button[type=submit]") as HTMLButtonElement
const title = () => document.querySelector("input[name=title]") as HTMLInputElement
const comment = () =>
  document.querySelector("textarea[name=comment]") as HTMLTextAreaElement

const fill = async (rating = true) => {
  await act(async () => {
    if (rating) {
      await userEvent.click(document.querySelector("input[type=radio][value='4']")!)
    }
    await userEvent.type(title(), "Lovely")
    await userEvent.type(comment(), "Smells great")
  })
}

beforeEach(() => createReview.mockReset())
afterEach(cleanup)

describe("ReviewForm", () => {
  it("shows a sign-in link for guests", () => {
    const { container } = render(<ReviewForm productId="p1" signedIn={false} />)
    const a = container.querySelector("a") as HTMLAnchorElement
    expect(a.textContent).toContain("Sign in to write a review")
    expect(a.getAttribute("href")).toBe("/account")
    expect(container.querySelector("form")).toBeNull()
  })

  it("has required fields with max lengths", () => {
    render(<ReviewForm productId="p1" signedIn />)
    expect(title().maxLength).toBe(100)
    expect(comment().maxLength).toBe(2000)
    expect(document.querySelectorAll("input[type=radio]").length).toBe(5)
  })

  it("blocks submit without a rating and shows a message", async () => {
    render(<ReviewForm productId="p1" signedIn />)
    await fill(false)
    await act(async () => {
      await userEvent.click(submitBtn())
    })
    expect(createReview).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Choose a rating")
  })

  it("exposes validation errors accessibly", async () => {
    render(<ReviewForm productId="p1" signedIn />)
    await act(async () => {
      await userEvent.click(submitBtn())
    })
    const alerts = Array.from(document.querySelectorAll("[role=alert]"))
    expect(alerts.map((a) => a.textContent)).toEqual([
      "Choose a rating",
      "Add a title",
      "Add a comment",
    ])
    expect(title().getAttribute("aria-invalid")).toBe("true")
    expect(title().getAttribute("aria-describedby")).toBe("review-title-error")
    expect(comment().getAttribute("aria-describedby")).toBe("review-comment-error")
    const fieldset = document.querySelector("fieldset")!
    expect(fieldset.getAttribute("aria-invalid")).toBe("true")
    expect(fieldset.getAttribute("aria-describedby")).toBe("review-rating-error")
  })

  it("has no invalid markers before submit", () => {
    render(<ReviewForm productId="p1" signedIn />)
    expect(document.querySelector("[aria-invalid]")).toBeNull()
    expect(document.querySelector("[aria-describedby]")).toBeNull()
  })

  it("blocks submit without title or comment", async () => {
    render(<ReviewForm productId="p1" signedIn />)
    await act(async () => {
      await userEvent.click(document.querySelector("input[type=radio][value='5']")!)
      await userEvent.click(submitBtn())
    })
    expect(createReview).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Add a title")
    expect(document.body.textContent).toContain("Add a comment")
  })

  it("submits, shows the success message and clears", async () => {
    createReview.mockResolvedValue({ ok: true })
    render(<ReviewForm productId="p1" signedIn />)
    await fill()
    await act(async () => {
      await userEvent.click(submitBtn())
    })
    expect(createReview).toHaveBeenCalledWith({
      productId: "p1",
      rating: 4,
      title: "Lovely",
      comment: "Smells great",
    })
    expect(document.body.textContent).toContain(
      "Thanks, your review is awaiting approval"
    )
    expect(title().value).toBe("")
    expect(comment().value).toBe("")
  })

  it("keeps typed values and shows the error on failure", async () => {
    createReview.mockResolvedValue({ ok: false, error: "Couldn't submit" })
    render(<ReviewForm productId="p1" signedIn />)
    await fill()
    await act(async () => {
      await userEvent.click(submitBtn())
    })
    expect(document.body.textContent).toContain("Couldn't submit")
    expect(title().value).toBe("Lovely")
    expect(comment().value).toBe("Smells great")
  })

  it("disables submit while pending", async () => {
    let resolve: (v: { ok: true }) => void = () => {}
    createReview.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    render(<ReviewForm productId="p1" signedIn />)
    await fill()
    await act(async () => {
      submitBtn().click()
    })
    expect(submitBtn().disabled).toBe(true)
    await act(async () => {
      submitBtn().click()
    })
    expect(createReview).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve({ ok: true })
    })
    expect(submitBtn().disabled).toBe(false)
  })
})
