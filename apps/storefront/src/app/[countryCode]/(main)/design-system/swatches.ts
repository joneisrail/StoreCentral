export type Swatch = { name: string; hex: string }

// Must match src/styles/tokens.css. swatches.test.ts fails if a token is
// added, removed or changed there without updating this list.
export const swatches: Swatch[] = [
  { name: "ivory", hex: "#faf7f2" },
  { name: "paper", hex: "#ffffff" },
  { name: "charcoal", hex: "#1e1d1b" },
  { name: "warm-grey", hex: "#6f685e" },
  { name: "line", hex: "#e6dfd3" },
  { name: "line-strong", hex: "#978e80" },
  { name: "gold", hex: "#c2a361" },
  { name: "gold-deep", hex: "#80651f" },
]

const channel = (value: number): number => {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const luminance = (color: string): number => {
  const n = parseInt(color.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  )
}

export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
