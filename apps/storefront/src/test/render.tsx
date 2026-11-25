import { act } from "react"
import type { ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import userEvent from "@testing-library/user-event"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

type Mounted = { root: Root; container: HTMLElement }

const mounted = new Set<Mounted>()

export function render(ui: ReactElement) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const entry: Mounted = { root, container }
  mounted.add(entry)

  act(() => {
    root.render(ui)
  })

  return {
    container,
    unmount: () => {
      if (!mounted.has(entry)) {
        return
      }
      act(() => {
        root.unmount()
      })
      container.remove()
      mounted.delete(entry)
    },
    rerender: (next: ReactElement) => {
      act(() => {
        root.render(next)
      })
    },
  }
}

export function cleanup(): void {
  for (const entry of Array.from(mounted)) {
    act(() => {
      entry.root.unmount()
    })
    entry.container.remove()
    mounted.delete(entry)
  }
}

export { act, userEvent }
