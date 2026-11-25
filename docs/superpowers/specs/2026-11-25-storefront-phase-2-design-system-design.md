# Storefront Phase 2: premium design system

Date: 2026-11-25. Status: draft for owner review. Parent: the storefront brief in `apps/storefront/CLAUDE.md` (its Phase 2) and `docs/storefront/IMPLEMENTATION_PLAN.md`. Phase 1 (foundation) is merged.

## Intent (assumptions, please correct)

- Who: shoppers in the United States buying branded perfume, on phones first; and the owner, who wants a luxury look instead of the Medusa starter's grey one.
- Problem: every screen today uses the starter's grey scale, Inter, small 2-8px radii and a "Medusa Store" wordmark. The brief's palette (ivory, charcoal, champagne gold, warm grey), serif headings and premium components do not exist.
- Success: change a small set of tokens and wrappers once and the whole existing storefront (home, store, product, cart, checkout, account) already looks like the luxury brief, with no layout shifts, accessible controls and no regression in cart or checkout. A dev-only preview page shows every component so the owner can judge the look without clicking through a store.
- Decided (owner said "take all recommended"): the palette and font pair below; light mode only.

## Current state (read from code)

- No `@medusajs/ui` package. Components are the storefront's own wrappers in `src/modules/common/components/ui/index.tsx` (Text, Heading, Button, Container, Badge, IconBadge, IconButton, Label, Input, Table, RadioGroup, Checkbox), plus `modal`, `input`, `native-select`, `checkbox`, `radio`, `divider`.
- Colours come from `@medusajs/ui-preset` (vendored in `packages/design-system/ui-preset`): `tailwind.config.js` uses it as a preset, and its plugin writes the `ui-*` colour variables onto `:root`. 267 class usages (`bg-ui-*`, `text-ui-*`, `border-ui-*`) read them. Overriding the variables after Tailwind's base layer re-themes all of them at once.
- Some wrappers hard-code Tailwind greys and black (for example `Button` uses `bg-black`, `hover:bg-gray-800`).
- Font: `Inter` declared in `tailwind.config.js` but no font is loaded; `layout.tsx` has none.
- No toast, no dropdown menu primitive, no shared drawer (the nav side menu and the search drawer are their own code), a `TODO` where the toaster was removed.
- Skeletons exist (15 files) but are screen-specific.

## Design

### Tokens

- New `src/styles/tokens.css`, imported by `globals.css` after the Tailwind base import. It overrides the `ui-preset` variables on `:root` and adds brand variables:
  - `--sc-ivory` `#FAF7F2` (page background), `--sc-paper` `#FFFFFF` (cards, inputs), `--sc-charcoal` `#1E1D1B` (text, primary button), `--sc-warm-grey` `#6F685E` (secondary text), `--sc-line` `#E6DFD3` (borders), `--sc-gold` `#C2A361` (accent fills, rules, icons), `--sc-gold-deep` `#80651F` (gold used as text or on ivory).
  - Gold on ivory fails body-text contrast, so gold is used for fills, borders and large display text only; text that must be gold uses `--sc-gold-deep`.
- `tailwind.config.js` maps the brand variables to utilities (`bg-ivory`, `text-charcoal`, `text-gold-deep`, `border-line`, ...), sets radius tokens (small, square-ish: 2px, 4px; `circle` stays), and a spacing and type scale for headings.
- Fonts: `next/font/google` in `layout.tsx`, `Cormorant Garamond` (headings, weights 500 and 600) and `Inter` (body), `display: swap`, exposed as `--font-serif` and `--font-sans`. next/font adjusts fallback metrics, which prevents layout shift. Build note: next/font/google downloads the font files at build time, so the build machine (and CI Docker build) needs outbound internet; the files are then self-hosted.
- Light mode only; `data-mode="light"` stays.

### Typography

`Heading` renders the serif at three levels with tracking and sizes from the scale; `Text` keeps the sans. The legacy utility classes in `globals.css` (`txt-*`, `text-*-semi`) are re-pointed at the new scale so existing screens inherit it.

### Components

Restyle in place, keeping prop APIs so no screen needs edits: Button (primary charcoal, secondary outline, transparent, plus a new `gold` variant), Input and native-select (paper background, line border, gold-deep focus ring, floating label kept), Checkbox, Radio, Badge, Container, Divider, Modal, product card (`product-preview` and `thumbnail`: 4:5 image area, name, brand line placeholder, price, hover image swap only when a second image exists), nav (store name from `NEXT_PUBLIC_STORE_NAME`, default "Store"; no hard-coded Medusa text), footer.

New primitives under `src/modules/common/components/`:

- `drawer` (side panel, right or left, focus trap, Escape and overlay close, restores focus, `aria-modal`), used first by the nav side menu so the pattern is proven; cart drawer itself is Phase 8.
- `dropdown-menu` (button plus menu, arrow-key navigation, Escape, `aria-expanded`), built on headless-ui which is already a dependency.
- `toast` (`ToastProvider`, `useToast()`, `role="status"`, auto-dismiss, pause on hover, dismiss button), mounted in the root layout.
- `skeleton` primitives (`Skeleton`, `SkeletonText`, `SkeletonImage`) with the same sizes as the real elements; existing screen skeletons switch to them where trivial and are otherwise left alone.

### Preview page

`/design-system` (under the existing `[countryCode]` segment): shows palette swatches with contrast ratios, type scale, buttons, inputs, badges, product card with fake props, drawer, dropdown, toast and skeletons. `notFound()` when `NODE_ENV === "production"`. It uses fixtures only; no product data.

### Accessibility and motion

Visible focus ring on every interactive element (gold-deep, 2px, offset), minimum 44px touch targets on mobile for buttons and icon buttons, `prefers-reduced-motion` disables the transitions and animations added here, and all text pairs meet WCAG AA (4.5:1; 3:1 for large text and UI borders).

## Testing

- Vitest: add `jsdom`, `@testing-library/react`, `@testing-library/user-event` and `@testing-library/jest-dom` (same versions the repo already uses) to the storefront; component tests run under a per-file `// @vitest-environment jsdom`.
- A token contrast test parses `tokens.css` and asserts the AA ratios for every text-on-background pair the design uses, so a future colour change that breaks accessibility fails CI.
- Component tests: Button variants and loading state; Input label and focus ring class; Drawer focus trap, Escape, focus return; DropdownMenu keyboard navigation; Toast show, auto-dismiss, dismiss button, `role="status"`.
- `tsc`, `next lint` and a production `next build` from a non-nested location (see `storefront-phase-1-merged` memory) must pass.
- Manual check by the owner on `/design-system` and on home, store, product, cart, checkout; screenshots at 390px and 1280px are attached to the final report.

## Not in this phase

Homepage sections and hero (Phase 3), listing filters (4), product page content (5), search UI changes (6), image optimisation (7), the cart drawer and checkout flow changes (8), wishlist, brands, content pages, dark mode, a logo (the wordmark is text until the owner supplies one), and any new fonts beyond the pair above.

## Decisions to confirm

1. Palette and fonts as above (Cormorant Garamond plus Inter). Tell me if you prefer a different serif.
2. Store name: set `NEXT_PUBLIC_STORE_NAME` in the deploy env; until then the nav shows "Store". What is the real name?
3. The build needs internet for the fonts (self-hosted afterwards). Acceptable?
