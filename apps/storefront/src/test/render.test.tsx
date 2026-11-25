// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import { cleanup, render, userEvent } from "./render"

describe("render harness", () => {
  it("mounts elements into document.body", () => {
    render(<button>hi</button>)
    const button = document.body.querySelector("button")
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe("hi")
    cleanup()
  })

  it("dispatches user events", async () => {
    const onClick = vi.fn()
    render(<button onClick={onClick}>go</button>)
    const user = userEvent.setup()
    await user.click(document.body.querySelector("button") as HTMLElement)
    expect(onClick).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("empties the body on cleanup", () => {
    render(<button>bye</button>)
    cleanup()
    expect(document.body.innerHTML).toBe("")
  })
})
