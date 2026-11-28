import { renderToStaticMarkup } from "react-dom/server"
import { Fragment } from "react"
import { describe, expect, it } from "vitest"
import { HIGHLIGHT_POST, HIGHLIGHT_PRE, renderHighlight } from "./highlight"

const html = (value: string) =>
  renderToStaticMarkup(<Fragment>{renderHighlight(value)}</Fragment>)

describe("renderHighlight", () => {
  it("exports the exact marker strings", () => {
    expect(HIGHLIGHT_PRE).toBe("<mark>")
    expect(HIGHLIGHT_POST).toBe("</mark>")
  })

  it("turns markers into a mark element followed by text", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes = renderHighlight("<mark>Lat</mark>tafa") as any[]
    expect(nodes[0].type).toBe("mark")
    expect(nodes[0].props.children).toBe("Lat")
    expect(nodes[1]).toBe("tafa")
    expect(html("<mark>Lat</mark>tafa")).toBe("<mark>Lat</mark>tafa")
  })

  it("keeps surrounding text and several marks", () => {
    expect(html("a <mark>b</mark> c <mark>d</mark>")).toBe(
      "a <mark>b</mark> c <mark>d</mark>"
    )
  })

  it("renders other HTML as escaped text", () => {
    expect(html("<img onerror=x>")).toBe("&lt;img onerror=x&gt;")
    expect(html("<mark><script>x</script></mark>")).toBe(
      "<mark>&lt;script&gt;x&lt;/script&gt;</mark>"
    )
    expect(html("<em>Lat</em>tafa")).toBe("&lt;em&gt;Lat&lt;/em&gt;tafa")
  })

  it("degrades unbalanced and nested markers to text", () => {
    expect(html("a <mark>b")).toBe("a &lt;mark&gt;b")
    expect(html("a</mark> b")).toBe("a&lt;/mark&gt; b")
    expect(html("<mark>a<mark>b</mark>")).toBe("&lt;mark&gt;a<mark>b</mark>")
  })

  it("honours custom tags and handles empty input", () => {
    const out = renderToStaticMarkup(
      <Fragment>{renderHighlight("[Lat]tafa", "[", "]")}</Fragment>
    )
    expect(out).toBe("<mark>Lat</mark>tafa")
    expect(renderHighlight("")).toBe("")
  })
})
