# CLAUDE CODE MASTER DEVELOPMENT INSTRUCTIONS
## Project: Premium Multi-Brand Perfume Ecommerce Platform

You are acting as a Senior Full-Stack Engineer, Ecommerce Architect, UI/UX Designer, Performance Engineer, and Technical SEO Specialist.

Your responsibility is to build a production-ready, premium multi-brand perfume ecommerce website using Medusa.js.

Do not build a generic ecommerce template. Build a distinctive luxury fragrance shopping experience.

---

# PART 1: PROJECT OBJECTIVES

Build a modern perfume ecommerce platform targeting customers in the United States.

Business model:
- Multi-brand perfume retailer.
- Sells internationally recognized perfume brands.
- No private-label or proprietary perfume products.
- Large product catalog.
- Multiple perfume brands, sizes, and variants.
- Online retail and promotional campaigns.

Primary objectives, in priority order:

1. Premium luxury website design.
2. Extremely fast product search.
3. Fast product image loading.
4. Excellent product discovery.
5. Mobile-first shopping experience.
6. Conversion-focused ecommerce UX.
7. Google SEO and AI search visibility.
8. Scalable architecture.

# PART 2: TECHNOLOGY STACK

Use the latest stable and mutually compatible versions.

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- Server Components
- Responsive design
- Framer Motion or lightweight CSS animations

Backend:
- Medusa.js
- Node.js
- PostgreSQL
- Redis where required
- Medusa Store API
- Medusa Admin

Search:
- Meilisearch
- Dedicated search indexing service
- Debounced autocomplete
- Search filters and facets
- Typo tolerance

Image delivery:
- Cloudflare CDN or compatible CDN.
- Next.js Image Optimization.
- WebP and AVIF.
- Responsive image sizes.
- Lazy loading.
- Image placeholders.

Infrastructure:
- Docker
- Docker Compose
- Environment-based configuration
- Production-ready deployment structure

Important:
Before selecting packages, inspect the installed versions and official compatibility requirements. Do not blindly upgrade existing dependencies.

# PART 3: DESIGN SYSTEM

Design a luxury perfume retail website.

Design direction:
- Modern luxury.
- Minimalist editorial layout.
- Premium fragrance boutique.
- High-end fashion ecommerce aesthetic.

Color palette:
- Primary: Ivory / Off-white.
- Secondary: Black / Charcoal.
- Accent: Champagne Gold.
- Neutral: Warm Gray.

Typography:
- Elegant serif headings.
- Modern sans-serif body.
- Strong typography hierarchy.

UI principles:
- Generous whitespace.
- Large product photography.
- Elegant navigation.
- Subtle animations.
- Premium product cards.
- Smooth transitions.
- Clean layouts.
- Consistent spacing.

Avoid:
- Generic ecommerce templates.
- Excessive animations.
- Too many colors.
- Unnecessary gradients.
- Heavy JavaScript effects.
- Unnecessary popups.
- Cluttered product pages.

Create reusable design tokens and components.

# PART 4: WEBSITE STRUCTURE

Create the following routes.

Public pages:

/
Home page.

/collections
All product collections.

/collections/[handle]
Individual collection.

/products/[handle]
Product details.

/brands
All perfume brands.

/brands/[handle]
Individual brand pages.

/search
Search results.

/categories/[handle]
Product category pages.

/cart
Shopping cart.

/checkout
Checkout flow.

/account
Customer account.

/account/orders
Order history.

/account/profile
Customer profile.

/wishlist
Wishlist.

/about
About the store.

/contact
Contact page.

/policies/*
Store policies.

Use proper Next.js routing conventions.

# PART 5: PHASED DEVELOPMENT PLAN

## PHASE 0 – Repository Audit and Architecture

Before writing code:

1. Inspect the complete repository.
2. Identify existing Medusa backend.
3. Identify existing Next.js storefront.
4. Inspect package.json files.
5. Check Node.js and package manager versions.
6. Check database configuration.
7. Check existing API integrations.
8. Identify reusable components.
9. Identify missing functionality.
10. Review current deployment architecture.

Create:

- docs/PROJECT_AUDIT.md
- docs/ARCHITECTURE.md
- docs/IMPLEMENTATION_PLAN.md
- docs/TECH_STACK.md

Do not overwrite working code unnecessarily.

If the repository already contains an implementation, extend it instead of rebuilding everything.

After the audit, present the implementation plan.

## PHASE 1 – Project Foundation

Tasks:

1. Configure frontend and backend communication.
2. Configure Medusa Store API.
3. Configure environment variables.
4. Configure PostgreSQL.
5. Configure Redis if required.
6. Configure CORS.
7. Configure frontend routing.
8. Create reusable API utilities.
9. Create shared TypeScript types.
10. Establish error handling.

Create a clean project structure.

Suggested frontend organization:

src/
  app/
  components/
    layout/
    navigation/
    product/
    search/
    cart/
    common/
  features/
    catalog/
    brands/
    search/
    checkout/
    wishlist/
  hooks/
  lib/
  services/
  types/
  styles/

Adapt this structure to the existing project and current Next.js conventions.

Deliverable:
Working frontend connected to Medusa.

Acceptance criteria:
- Storefront can communicate with Medusa.
- Products can be retrieved.
- Product categories can be retrieved.
- Errors are handled correctly.
- No exposed secret keys.

## PHASE 2 – Premium Design System

Build:

1. Global typography.
2. Color variables.
3. Spacing system.
4. Buttons.
5. Product cards.
6. Image containers.
7. Navigation components.
8. Dropdown menus.
9. Modal components.
10. Drawer components.
11. Loading skeletons.
12. Toast notifications.

Implement responsive layouts.

Deliverable:
Reusable premium design system.

Acceptance criteria:
- Consistent UI across pages.
- Desktop and mobile support.
- Accessible controls.
- Smooth interactions.
- No unnecessary layout shifts.

## PHASE 3 – Homepage

Build the complete homepage.

Sections:

1. Announcement bar.
2. Main navigation.
3. Search bar.
4. Hero banner.
5. Shop by category.
6. Featured brands.
7. Best sellers.
8. New arrivals.
9. Trending fragrances.
10. Men's collection.
11. Women's collection.
12. Unisex collection.
13. Arabic fragrances.
14. Niche fragrances.
15. Promotional campaigns.
16. Editorial content.
17. Newsletter.
18. Footer.

Requirements:

- Dynamic product sections from Medusa.
- Dynamic brand collections.
- Responsive product grids.
- Optimized hero image.
- Premium typography.
- Subtle animations.

Acceptance criteria:
- Homepage works with real Medusa data.
- No production mock products.
- Mobile layout is optimized.
- Main hero content loads quickly.

## PHASE 4 – Product Catalog

Build product listing pages.

Features:

- Product grid.
- Product sorting.
- Brand filters.
- Category filters.
- Price range.
- Gender filters.
- Fragrance family filters.
- Fragrance note filters.
- Availability filters.
- Sale filters.
- Pagination or infinite scrolling.
- Grid/list toggle.
- Quick add to cart.
- Wishlist.
- Product badges.

Use URL query parameters for shareable filters and sorting.

Do not load the complete catalog unnecessarily.

Acceptance criteria:
- Filters work with real product data.
- Sorting works correctly.
- Pagination works.
- Search and filters are mobile-friendly.
- Product cards use optimized thumbnails.

## PHASE 5 – Product Detail Pages

Create premium product detail pages.

Display:

- Product gallery.
- Product title.
- Brand.
- SKU.
- Price.
- Discount price.
- Availability.
- Product description.
- Size variants.
- Fragrance family.
- Gender.
- Top notes.
- Middle notes.
- Base notes.
- Concentration.
- Product specifications.
- Quantity selector.
- Add to cart.
- Buy now.
- Shipping information.
- Customer reviews.
- Related products.
- Recently viewed products.

Use Medusa product and variant data.

Create appropriate custom product metadata for fragrance-specific attributes.

Do not duplicate Medusa's existing product and variant functionality.

Acceptance criteria:
- Product pages work with real product records.
- Variants update prices correctly.
- Add-to-cart works.
- Images are optimized.
- SEO metadata is dynamic.

## PHASE 6 – ADVANCED SEARCH ENGINE

This is a critical phase.

Integrate Meilisearch.

Build an advanced search interface with:

1. Instant autocomplete.
2. Search suggestions.
3. Product thumbnails.
4. Product names.
5. Brand names.
6. Prices.
7. Typo tolerance.
8. Partial matching.
9. SKU search.
10. Fragrance notes search.
11. Fragrance family search.
12. Synonym support.
13. Popular searches.
14. Recent searches.
15. Trending products.
16. Search result highlighting.
17. Keyboard navigation.
18. Mobile search overlay.

Example searches:

"Lattafa"
"Khamrah"
"Vanilla perfume"
"Oud perfume"
"Men's fragrance"
"Fresh citrus"
"YSL"
"EDP 100ml"

Search should support:

- Brand name.
- Product name.
- SKU.
- Fragrance family.
- Fragrance notes.
- Product category.
- Gender.
- Concentration.

Search architecture:

Medusa Product Events
       |
       v
Product Indexing Service
       |
       v
Meilisearch
       |
       v
Next.js Search Interface

Requirements:

- Index products when created.
- Update indexed records when products change.
- Remove records when products are deleted.
- Handle indexing failures.
- Support full reindexing.
- Support pagination.
- Use debouncing.
- Cache appropriate queries.
- Never expose the Meilisearch master key to the browser.

Target:
- Typical indexed search response under 200ms, subject to infrastructure and network conditions.
- Smooth autocomplete.
- No unnecessary API requests.

Create:
docs/SEARCH_ARCHITECTURE.md

Acceptance criteria:
- Search works against the real product catalog.
- Product indexing remains synchronized.
- Typo tolerance works.
- Search filters work.
- No sensitive credentials are exposed.

## PHASE 7 – IMAGE PERFORMANCE

Treat image loading as a core feature.

Implement:

1. CDN integration.
2. AVIF and WebP.
3. Responsive images.
4. Proper image dimensions.
5. Lazy loading.
6. Priority loading for the main hero image.
7. Optimized product thumbnails.
8. Blur placeholders.
9. Browser caching.
10. Appropriate cache headers.
11. Avoid unnecessary original-resolution images.
12. Prevent cumulative layout shifts.

Image loading strategy:

Homepage:
- Prioritize hero image.
- Lazy-load lower sections.

Product listings:
- Load appropriately sized thumbnails.
- Lazy-load images outside the viewport.

Product details:
- Load the primary image promptly.
- Load additional gallery images as needed.

Ensure images do not block the rendering of other page content.

Acceptance criteria:
- Responsive image delivery.
- No oversized product thumbnails.
- No major layout shifts.
- CDN configuration documented.

## PHASE 8 – CART AND CHECKOUT

Implement Medusa cart functionality.

Features:

- Add product.
- Update quantity.
- Remove product.
- Cart drawer.
- Cart page.
- Cart subtotal.
- Shipping options.
- Discount codes.
- Checkout.
- Customer information.
- Shipping address.
- Payment provider integration.
- Order confirmation.

Important:
Use actual Medusa cart and checkout functionality.

Never simulate successful payments.

Keep payment credentials on the server side.

Acceptance criteria:
- Cart persists correctly.
- Product variants are respected.
- Checkout works with configured payment provider.
- Errors are displayed correctly.
- Order is created through Medusa.

## PHASE 9 – CUSTOMER EXPERIENCE

Implement:

- Customer registration.
- Login.
- Logout.
- Password recovery.
- Customer profile.
- Order history.
- Order details.
- Address management.
- Wishlist.
- Recently viewed products.
- Order tracking.

Use Medusa's supported authentication and customer APIs.

Acceptance criteria:
- Authentication works.
- Customer-specific data is protected.
- Guest shopping works.
- Wishlist persistence works.

## PHASE 10 – FRAGRANCE DISCOVERY

Build a fragrance discovery experience.

Allow customers to explore by:

- Fresh.
- Woody.
- Oriental.
- Floral.
- Citrus.
- Sweet.
- Gourmand.
- Aquatic.
- Aromatic.
- Spicy.
- Oud.
- Vanilla.

Create dedicated fragrance collection pages.

Build a fragrance finder interface where customers can select preferences and discover matching products.

Use actual product metadata and search indexes.

Do not invent fragrance characteristics.

## PHASE 11 – SEO AND AI SEARCH

Implement:

- Dynamic page titles.
- Meta descriptions.
- Canonical URLs.
- XML sitemap.
- Robots.txt.
- Product JSON-LD.
- Breadcrumb JSON-LD.
- Organization schema.
- Open Graph.
- Twitter metadata.
- Product image alt text.
- Internal linking.
- Brand SEO pages.
- Collection SEO pages.

Optimize product content for:

- Google Search.
- Google Shopping.
- AI-powered search.
- Conversational product discovery.

Use unique, factual descriptions.

Do not generate misleading claims about product authenticity, performance, ingredients, or longevity.

## PHASE 12 – PERFORMANCE AND TESTING

Perform:

- Lighthouse audits.
- Core Web Vitals checks.
- Frontend performance tests.
- Search latency tests.
- API response tests.
- Image loading tests.
- Mobile responsiveness tests.
- Accessibility tests.
- Checkout tests.
- Authentication tests.
- SEO validation.

Performance goals:

- Lighthouse Performance: 90+.
- Accessibility: 90+.
- SEO: 95+.
- Best Practices: 90+.

Treat these as targets, not assumed results.

Optimize:
- LCP.
- INP.
- CLS.
- JavaScript bundle size.
- API request count.
- Database queries.
- Image payload size.

Create:
docs/PERFORMANCE_REPORT.md
docs/TESTING_REPORT.md

## PHASE 13 – PRODUCTION DEPLOYMENT

Prepare:

- Docker configuration.
- Production environment variables.
- PostgreSQL configuration.
- Redis configuration if required.
- Medusa production setup.
- Next.js production build.
- Search service deployment.
- CDN configuration.
- HTTPS.
- Domain configuration.
- Database backup instructions.
- Logging and monitoring.
- Health checks.

Deployment should be reproducible.

Create:
- docker-compose.yml
- .env.example
- README.md
- docs/DEPLOYMENT.md

Do not commit secrets.

---

# PART 6: DEVELOPMENT RULES FOR CLAUDE CODE

Follow these rules throughout development.

RULE 1:
Never modify existing working architecture without understanding it.

RULE 2:
Always inspect the relevant files before changing code.

RULE 3:
Work phase by phase.

RULE 4:
Do not skip acceptance criteria.

RULE 5:
Do not use mock data for production functionality.

RULE 6:
Use actual Medusa APIs.

RULE 7:
Keep code modular and maintainable.

RULE 8:
Avoid unnecessary dependencies.

RULE 9:
Use TypeScript correctly.

RULE 10:
Test every major feature after implementation.

RULE 11:
Do not claim a feature is complete without testing it.

RULE 12:
Document important architecture decisions.

RULE 13:
Preserve existing environment configurations.

RULE 14:
Never expose secret API keys.

RULE 15:
Do not implement every phase in one giant code-generation operation.

---

# PART 7: CLAUDE CODE EXECUTION STRATEGY

Use an agentic development workflow.

For every phase:

1. Inspect relevant code.
2. Explain the implementation approach.
3. Identify files to create or modify.
4. Implement the feature.
5. Run TypeScript checks.
6. Run linting.
7. Run relevant tests.
8. Fix errors.
9. Review performance.
10. Update documentation.
11. Report completed work.
12. Identify remaining tasks.

Do not move to the next major phase if the current phase has unresolved critical errors.

Use specialized subagents where useful:
- Frontend UI developer.
- Backend Medusa developer.
- Search engineer.
- Performance engineer.
- QA engineer.

Subagents must follow the same project architecture and must not independently overwrite shared files without coordination.

# PART 8: FIRST TASK

Start with PHASE 0 only.

Analyze my existing repository.

Do not immediately start building the entire website.

First provide:

1. Current project architecture.
2. Existing technologies and versions.
3. Existing Medusa integration.
4. Missing components.
5. Recommended architecture.
6. Required dependencies.
7. Database requirements.
8. Search infrastructure requirements.
9. Image CDN requirements.
10. Phase-by-phase development plan.

After completing the audit, wait for my approval before implementing PHASE 1.

Your ultimate goal is to deliver a production-ready, premium multi-brand perfume ecommerce platform with exceptional search speed, image performance, and user experience.