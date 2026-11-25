# Storefront Design System

Reference for the storefront design tokens, shared components and accessibility rules. The storefront is `apps/storefront`.

## Tokens

Tokens are CSS custom properties defined in `apps/storefront/src/styles/tokens.css` and exposed as Tailwind colours in `apps/storefront/tailwind.config.js`. The palette is light mode only.

| Token (Tailwind name) | CSS variable | Hex | Intended use |
| --- | --- | --- | --- |
| `ivory` | `--sc-ivory` | `#faf7f2` | Page background, hover fill |
| `paper` | `--sc-paper` | `#ffffff` | Cards, inputs, panels |
| `charcoal` | `--sc-charcoal` | `#1e1d1b` | Body text, headings, primary button fill |
| `warm-grey` | `--sc-warm-grey` | `#6f685e` | Secondary text, placeholders |
| `line` | `--sc-line` | `#e6dfd3` | Dividers, subtle borders, skeletons |
| `line-strong` | `--sc-line-strong` | `#978e80` | Borders of form controls (non-text UI) |
| `gold` | `--sc-gold` | `#c2a361` | Accent fill (gold button) |
| `gold-deep` | `--sc-gold-deep` | `#80651f` | Focus ring, links, accent text |

### Contrast pairs

Ratios are WCAG 2 contrast ratios computed from the hex values.

| Foreground | Background | Ratio | Use |
| --- | --- | --- | --- |
| `charcoal` | `ivory` | 15.76:1 | Body text |
| `charcoal` | `paper` | 16.84:1 | Body text on cards |
| `warm-grey` | `ivory` | 5.15:1 | Secondary text (AA) |
| `warm-grey` | `paper` | 5.50:1 | Secondary text (AA) |
| `gold-deep` | `ivory` | 5.17:1 | Accent text, links (AA) |
| `gold-deep` | `paper` | 5.53:1 | Accent text, links (AA) |
| `paper` | `gold-deep` | 5.53:1 | Text on a gold-deep fill |
| `charcoal` | `gold` | 6.98:1 | Text on the gold button |
| `line-strong` | `ivory` | 3.02:1 | Control borders (3:1 non-text) |
| `line-strong` | `paper` | 3.23:1 | Control borders (3:1 non-text) |
| `gold` | `ivory` | 2.26:1 | Fails AA. Never use for text |

`tokens.test.ts` asserts these thresholds, so a palette change that breaks AA fails the test suite.

## Components

### Button

`@modules/common/components/ui`. Props: `variant` (`primary` | `secondary` | `transparent` | `gold`, default `primary`), `size` (`small` | `medium` | `large`, default `medium`), `isLoading`, plus all native button attributes.

- `primary`: charcoal fill, ivory text, gold-deep on hover.
- `secondary`: paper fill, line-strong border.
- `transparent`: no fill, line fill on hover.
- `gold`: gold fill, charcoal text.

Also in the same module: `Input` (`label` prop), `Checkbox` (`label`, `id`), `Badge` (`color`: green, red, blue, orange, grey, purple), `Heading`, `Text`, `IconButton`.

### Skeleton

`@modules/common/components/skeleton`.

- `Skeleton({ className })`: a pulsing bar. Size it with classes.
- `SkeletonText({ lines = 3 })`: stacked bars, the last one shorter.
- `SkeletonImage({ ratio = "4/5" })`: an image placeholder. `ratio` is `"1/1"`, `"4/5"` or `"16/9"`.

All are `aria-hidden`. The pulse animation is disabled under reduced motion.

### Toast

`@modules/common/components/toast`. `ToastProvider` is mounted in the root layout. Call `useToast()` inside any client component:

```ts
const { toast, dismiss } = useToast()
const id = toast({
  title: "Saved",
  description: "Optional detail",
  tone: "success", // "info" (default) | "success" | "error"
  durationMs: 5000, // default 5000
})
dismiss(id)
```

`error` toasts use `role="alert"`; the others use `role="status"`. Hovering a toast pauses its timer. `useToast` throws outside a provider.

### Drawer

`@modules/common/components/drawer` (default export). Props: `open`, `onClose`, `title`, `side` (`"left"` | `"right"`, default `"right"`), `children`, `className`, and optional `backdropTestId`, `panelTestId`, `closeTestId`. Built on Headless UI `Dialog`, so focus is trapped and Escape closes it. The close button receives initial focus.

### DropdownMenu

`@modules/common/components/dropdown-menu` (default export). Props: `label` (trigger text) and `items`, an array of `{ label, onSelect?, href?, disabled? }`. Items with `href` render as localized links, others as buttons. Keyboard navigation comes from Headless UI `Menu`.

### ProductCardView

`@modules/products/components/product-preview` (named export). A presentational card with no data fetching. Props: `title`, `href`, `thumbnail?` (string or null; a placeholder renders when empty), `priceLabel?`, `originalPriceLabel?` (shows the sale price treatment when set). Titles clamp to two lines. The default export, `ProductPreview`, maps a Medusa product to this view.

## Accessibility rules

- Focus ring: every interactive element shows a `gold-deep` ring or outline on `focus-visible`, with a 2px width and an offset.
- Touch targets: interactive controls are at least 44px high on small screens (`min-h-[44px]`, relaxed with `lg:`).
- Reduced motion: transitions and animations use `motion-safe:` or `motion-reduce:transition-none`, so they stop for users who prefer reduced motion.
- Contrast: text meets WCAG AA (4.5:1); non-text UI such as control borders meets 3:1. Use only the pairs listed above.
- Gold is never body text. `gold` (2.26:1 on ivory) is for fills only. For gold-coloured text use `gold-deep`.

## Tailwind limitation: no alpha modifiers on token colours

Token colours are defined as `var(--sc-...)` strings, so Tailwind cannot inject an alpha channel. A class such as `bg-charcoal/40` generates nothing. Use an explicit arbitrary value instead, for example the drawer overlay uses:

```
bg-[rgb(30_29_27/0.4)]
```

## Adding a token

1. Add `--sc-<name>: #rrggbb;` to `:root` in `apps/storefront/src/styles/tokens.css`.
2. Add `"<name>": "var(--sc-<name>)"` under `theme.extend.colors` in `apps/storefront/tailwind.config.js`.
3. Add the hex check and any contrast assertions to `apps/storefront/src/styles/tokens.test.ts`.
4. Add a swatch to the `swatches` list in `apps/storefront/src/app/[countryCode]/(main)/design-system/swatches.ts` and a row to the tables above. `swatches.test.ts` compares that list with `tokens.css` in both directions, so it fails if the swatch is forgotten or its hex differs.

## Viewing the preview

Run the storefront dev server and open `/<countryCode>/design-system`, for example `http://localhost:8000/us/design-system`. The page shows the tokens with contrast ratios, the type scale, buttons, form controls, badges, product cards, drawer, dropdown menu, toasts and skeletons, all with fixture data.

The page is only available outside production. When `NODE_ENV` is `production` it returns a 404 (`isPreviewEnabled` in `design-system/gate.ts`). It is also marked `noindex`.

## Verification results

Date: 2026-11-25. Run on branch storefront-phase-2 at the commit that adds this section.

- Typecheck (tsc --noEmit): 0 errors.
- Unit tests (vitest, apps/storefront): 16 files, 104 tests, all pass.
- Lint (next lint): 0 errors, 3 warnings that were there before this phase (react-hooks/exhaustive-deps in checkout and product-actions).
- Deploy workflow tests (node --test deploy/*.test.mjs): 66 pass, 0 fail.
- Production build (next build) from a copy outside the worktree: exit 0, fonts fetched. The first attempt failed because side-menu held a lone Latin-1 byte (invalid UTF-8); fixed and a test now checks every source file is valid UTF-8.
- Secret scan of .next/static for sk_live, sk_test and whsec_: no matches.
- Built server against the local backend: /us, /us/store, a product page and /us/cart return 200. /us/design-system returns 404 in production as intended. The home page shows the store name (default "Store"), no "Medusa Store" text, and the charcoal footer band.

Not checked: pages were not opened in a browser, so there are no screenshots and no check of layout jump, fonts as rendered, focus rings, the drawer or the toasts on real screens; no real catalog (4 demo clothing products locally); checkout payment; the Docker image build; the first CI run.
