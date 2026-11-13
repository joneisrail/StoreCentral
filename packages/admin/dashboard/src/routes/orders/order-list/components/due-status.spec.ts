import { describe, expect, it } from "vitest"

import { getDueStatus } from "./due-status"

const d = (s: string) => new Date(s)

describe("getDueStatus", () => {
  it("returns null for no deadline", () => {
    expect(getDueStatus(null, d("2026-11-14T12:00:00Z"), "UTC")).toBeNull()
  })

  it("overdue when now is after the deadline", () => {
    expect(
      getDueStatus(d("2026-11-14T10:00:00Z"), d("2026-11-14T10:00:01Z"), "UTC")
    ).toEqual({ kind: "overdue" })
  })

  it("today for the same calendar day later on", () => {
    expect(
      getDueStatus(d("2026-11-14T20:00:00Z"), d("2026-11-14T08:00:00Z"), "UTC")
    ).toEqual({ kind: "today" })
  })

  it("deadline equal to now is not overdue", () => {
    const t = d("2026-11-14T08:00:00Z")
    expect(getDueStatus(t, t, "UTC")).toEqual({ kind: "today" })
  })

  it("tomorrow for the next calendar day", () => {
    expect(
      getDueStatus(d("2026-11-15T01:00:00Z"), d("2026-11-14T23:00:00Z"), "UTC")
    ).toEqual({ kind: "tomorrow" })
  })

  it("days for 3 calendar days ahead", () => {
    expect(
      getDueStatus(d("2026-11-17T10:00:00Z"), d("2026-11-14T10:00:00Z"), "UTC")
    ).toEqual({ kind: "days", days: 3 })
  })

  it("rolls over at local midnight in Asia/Dhaka (UTC+6)", () => {
    // 19:00Z = 01:00 on the 15th in Dhaka; deadline 21:00Z = 03:00 on the 15th.
    expect(
      getDueStatus(
        d("2026-11-14T21:00:00Z"),
        d("2026-11-14T19:00:00Z"),
        "Asia/Dhaka"
      )
    ).toEqual({ kind: "today" })
    // 17:00Z = 23:00 on the 14th in Dhaka: same deadline is the next local day
    // (a UTC comparison would wrongly say today).
    expect(
      getDueStatus(
        d("2026-11-14T21:00:00Z"),
        d("2026-11-14T17:00:00Z"),
        "Asia/Dhaka"
      )
    ).toEqual({ kind: "tomorrow" })
  })

  it("rolls over at local midnight in America/New_York (UTC-5 in Nov)", () => {
    // 03:00Z = 22:00 on the 14th in NY; deadline 06:00Z = 01:00 on the 15th.
    expect(
      getDueStatus(
        d("2026-11-15T06:00:00Z"),
        d("2026-11-15T03:00:00Z"),
        "America/New_York"
      )
    ).toEqual({ kind: "tomorrow" })
    // now 06:00Z = 01:00 on the 15th in NY; deadline 20:00Z same NY day.
    expect(
      getDueStatus(
        d("2026-11-15T20:00:00Z"),
        d("2026-11-15T06:00:00Z"),
        "America/New_York"
      )
    ).toEqual({ kind: "today" })
  })
})
