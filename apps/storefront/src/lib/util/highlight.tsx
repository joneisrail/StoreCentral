import type { ReactNode } from "react"

/**
 * The only markers recognised. The search validators let a caller choose the
 * tags, so the storefront always asks for exactly these and nothing else is
 * ever treated as markup.
 */
export const HIGHLIGHT_PRE = "<mark>"
export const HIGHLIGHT_POST = "</mark>"

/**
 * Turns a highlighted string into text and `<mark>` elements. No HTML is
 * parsed: everything outside balanced marker pairs is plain React text, so
 * markup-looking content in a title stays inert.
 */
export function renderHighlight(
  value: string,
  pre: string = HIGHLIGHT_PRE,
  post: string = HIGHLIGHT_POST
): ReactNode {
  if (!value) {
    return ""
  }
  if (!pre || !post) {
    return value
  }

  const nodes: ReactNode[] = []
  let text = ""
  let i = 0
  let key = 0

  while (i < value.length) {
    if (value.startsWith(pre, i)) {
      const start = i + pre.length
      const end = value.indexOf(post, start)
      const inner = end === -1 ? null : value.slice(start, end)
      // Unclosed or nested open marker: treat this opener as text.
      if (inner !== null && !inner.includes(pre)) {
        if (text) {
          nodes.push(text)
          text = ""
        }
        nodes.push(<mark key={key++}>{inner}</mark>)
        i = end + post.length
        continue
      }
    }
    text += value[i]
    i++
  }
  if (text) {
    nodes.push(text)
  }
  return nodes
}
