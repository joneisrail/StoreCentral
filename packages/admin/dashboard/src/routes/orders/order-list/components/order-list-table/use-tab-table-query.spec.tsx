// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { ReactNode } from "react"
import { MemoryRouter, useSearchParams } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

// `order-search` (imported for its pure normaliser) reaches `lib/client`,
// which reads build-time defines a plain test run does not have.
vi.mock("../../../../../lib/client", () => ({ sdk: {} }))

import { useTabTableQuery } from "./use-tab-table-query"

const setup = (initial = "/", prefix = "rts") => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  )
  return renderHook(
    () => ({ q: useTabTableQuery(prefix), sp: useSearchParams()[0] }),
    { wrapper }
  )
}

afterEach(() => vi.useRealTimers())

describe("useTabTableQuery", () => {
  it("round-trips filters through prefixed URL params", () => {
    const { result } = setup()
    act(() =>
      result.current.q.setFilter("payment_status", ["captured", "refunded"])
    )
    expect(result.current.sp.get("rts_f_payment_status")).toBe(
      "captured,refunded"
    )
    expect(result.current.q.filters.payment_status).toEqual([
      "captured",
      "refunded",
    ])
    act(() => result.current.q.removeFilter("payment_status"))
    expect(result.current.sp.has("rts_f_payment_status")).toBe(false)
    expect(result.current.q.hasUserCriteria).toBe(false)
  })

  it("does not leak criteria between prefixes", () => {
    const { result } = setup("/?shp_f_payment_status=captured&shp_q=smith")
    expect(result.current.q.filters).toEqual({})
    expect(result.current.q.search).toBe("")
    expect(result.current.q.hasUserCriteria).toBe(false)
  })

  it("reads the search and filters from the URL", () => {
    const { result } = setup("/?rts_q=smith&rts_f_sku=ABC")
    expect(result.current.q.search).toBe("smith")
    expect(result.current.q.searchParams).toEqual({ q: "smith", sku: "ABC" })
  })

  it("debounces the search 300 ms before it enters the URL", () => {
    vi.useFakeTimers()
    const { result } = setup()
    act(() => result.current.q.setSearch("smi"))
    act(() => result.current.q.setSearch("smith"))
    expect(result.current.q.search).toBe("smith")
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current.sp.has("rts_q")).toBe(false)
    expect(result.current.q.searchParams).toEqual({})
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.sp.get("rts_q")).toBe("smith")
    expect(result.current.q.searchParams).toEqual({ q: "smith" })
  })

  it("has no search params when only direct filters are active", () => {
    const { result } = setup(
      "/?rts_f_payment_status=captured&rts_f_region_id=r1"
    )
    expect(result.current.q.searchParams).toEqual({})
    expect(result.current.q.hasSearchCriteria).toBe(false)
    expect(result.current.q.hasUserCriteria).toBe(true)
  })

  it("does not search a q shorter than 2 characters", () => {
    const { result } = setup("/?rts_q=a")
    expect(result.current.q.searchParams).toEqual({})
    expect(result.current.q.hasUserCriteria).toBe(false)
  })

  it("intersects payment status with the tab list", () => {
    const { result } = setup("/?rts_f_payment_status=captured,refunded")
    const query = result.current.q.toOrdersQuery(
      {
        payment_status: ["captured", "partially_captured"],
        status: { $nin: ["canceled"] },
      },
      null
    )
    expect(query.payment_status).toEqual(["captured"])
    expect(query.status).toEqual({ $nin: ["canceled"] })
  })

  it("uses the user list when the tab has none", () => {
    const { result } = setup("/?rts_f_fulfillment_status=shipped")
    expect(result.current.q.toOrdersQuery({}, null).fulfillment_status).toEqual(
      ["shipped"]
    )
  })

  it("lists nothing on an empty intersection", () => {
    const { result } = setup("/?rts_f_payment_status=refunded")
    const query = result.current.q.toOrdersQuery(
      { payment_status: ["captured"] },
      null
    )
    expect(query.id).toBe("__no_match__")
  })

  it("turns search results into id $in minus the held ids", () => {
    const { result } = setup("/?rts_f_sku=ABC")
    const query = result.current.q.toOrdersQuery({ id: { $nin: ["o2"] } }, [
      "o1",
      "o2",
      "o3",
    ])
    expect(query.id).toEqual({ $in: ["o1", "o3"] })
    expect(query).not.toHaveProperty("sku")
    expect(query).not.toHaveProperty("q")
  })

  it("lists nothing when the search matches only held orders or nothing", () => {
    const { result } = setup("/?rts_q=smith")
    expect(
      result.current.q.toOrdersQuery({ id: { $nin: ["o1"] } }, ["o1"]).id
    ).toBe("__no_match__")
    expect(result.current.q.toOrdersQuery({}, []).id).toBe("__no_match__")
    expect(result.current.q.toOrdersQuery({}, null).id).toBe("__no_match__")
  })

  it("keeps a plain-string id sentinel", () => {
    const { result } = setup("/?rts_q=smith")
    expect(
      result.current.q.toOrdersQuery({ id: "__no_hold_tag__" }, ["o1"]).id
    ).toBe("__no_hold_tag__")
  })

  it("leaves the id filter alone without search criteria", () => {
    const { result } = setup(
      "/?rts_f_region_id=reg_1,reg_2&rts_f_tag_id=t1&rts_f_sales_channel_id=sc1"
    )
    const query = result.current.q.toOrdersQuery({ id: { $nin: ["o2"] } }, null)
    expect(query.id).toEqual({ $nin: ["o2"] })
    expect(query.region_id).toEqual(["reg_1", "reg_2"])
    expect(query.tag_id).toEqual(["t1"])
    expect(query.sales_channel_id).toEqual(["sc1"])
  })

  it("keeps a tab-defining tag instead of widening it", () => {
    const { result } = setup("/?rts_f_tag_id=t1")
    expect(
      result.current.q.toOrdersQuery({ tag_id: "hold" }, null).tag_id
    ).toBe("hold")
  })

  it("maps created_at and total to operator maps", () => {
    const created = encodeURIComponent(
      JSON.stringify({ $gte: "2026-01-01", $lte: "2026-02-01" })
    )
    const total = encodeURIComponent(JSON.stringify({ $gt: "10", $lt: "50" }))
    const { result } = setup(
      `/?rts_f_created_at=${created}&rts_f_total=${total}`
    )
    const query = result.current.q.toOrdersQuery({}, null)
    expect(query.created_at).toEqual({
      $gte: "2026-01-01",
      $lte: "2026-02-01",
    })
    expect(query.total).toEqual({ $gt: 10, $lt: 50 })
  })

  it("ignores malformed JSON filters", () => {
    const { result } = setup("/?rts_f_created_at=%7Bnope&rts_f_total=abc")
    const query = result.current.q.toOrdersQuery({}, null)
    expect(query).not.toHaveProperty("created_at")
    expect(query).not.toHaveProperty("total")
  })

  it("clearAll removes the search and every filter of its prefix only", () => {
    const { result } = setup(
      "/?rts_q=smith&rts_f_sku=A&rts_f_payment_status=captured&shp_q=keep"
    )
    act(() => result.current.q.clearAll())
    expect(result.current.q.search).toBe("")
    expect(result.current.sp.has("rts_q")).toBe(false)
    expect(result.current.sp.has("rts_f_sku")).toBe(false)
    expect(result.current.sp.has("rts_f_payment_status")).toBe(false)
    expect(result.current.sp.get("shp_q")).toBe("keep")
    expect(result.current.q.hasUserCriteria).toBe(false)
  })

  it("changes criteriaKey with the active criteria only", () => {
    const { result } = setup()
    const empty = result.current.q.criteriaKey
    act(() => result.current.q.setFilter("sku", ["ABC"]))
    const withSku = result.current.q.criteriaKey
    expect(withSku).not.toBe(empty)
    act(() => result.current.q.setFilter("sku", ["ABC"]))
    expect(result.current.q.criteriaKey).toBe(withSku)
    act(() => result.current.q.removeFilter("sku"))
    expect(result.current.q.criteriaKey).toBe(empty)
  })
})
