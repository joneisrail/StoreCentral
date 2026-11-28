export type NavState = { active: number; count: number }

export type NavAction =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "reset"
  | { type: "count"; count: number }

/** `active` -1 means focus is on the input rather than an option. */
export function navReducer(state: NavState, action: NavAction): NavState {
  const { active, count } = state

  if (typeof action === "object") {
    const n = Math.max(0, Math.trunc(action.count) || 0)
    return { count: n, active: Math.min(active, n - 1) }
  }
  if (count <= 0) {
    return { active: -1, count: 0 }
  }
  switch (action) {
    case "next":
      return { count, active: active >= count - 1 ? -1 : active + 1 }
    case "prev":
      return { count, active: active <= -1 ? count - 1 : active - 1 }
    case "first":
      return { count, active: 0 }
    case "last":
      return { count, active: count - 1 }
    case "reset":
      return { count, active: -1 }
    default:
      return state
  }
}
