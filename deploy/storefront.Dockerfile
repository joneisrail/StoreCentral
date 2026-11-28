# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/storefront.Dockerfile .
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they are build arguments here. Changing one needs a rebuild of this image.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY apps/storefront/package.json ./apps/storefront/
RUN yarn workspaces focus @dtc/storefront
COPY apps/storefront ./apps/storefront
ARG NEXT_PUBLIC_MEDUSA_BACKEND_URL
ARG NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_DEFAULT_REGION
ARG NEXT_PUBLIC_STRIPE_KEY
ARG NEXT_PUBLIC_STORE_NAME
ARG NEXT_PUBLIC_NEWSLETTER_ACTION_URL
ARG NEXT_PUBLIC_IMAGE_ORIGIN
ENV NEXT_PUBLIC_MEDUSA_BACKEND_URL=$NEXT_PUBLIC_MEDUSA_BACKEND_URL \
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=$NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_DEFAULT_REGION=$NEXT_PUBLIC_DEFAULT_REGION \
    NEXT_PUBLIC_STRIPE_KEY=$NEXT_PUBLIC_STRIPE_KEY \
    NEXT_PUBLIC_STORE_NAME=$NEXT_PUBLIC_STORE_NAME \
    NEXT_PUBLIC_NEWSLETTER_ACTION_URL=$NEXT_PUBLIC_NEWSLETTER_ACTION_URL \
    NEXT_PUBLIC_IMAGE_ORIGIN=$NEXT_PUBLIC_IMAGE_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1
RUN yarn workspace @dtc/storefront build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8000
# Next traces from the workspace root, so server.js lands in apps/storefront.
COPY --from=build --chown=node:node /app/apps/storefront/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=build --chown=node:node /app/apps/storefront/public ./apps/storefront/public
WORKDIR /app/apps/storefront
COPY deploy/check-env.mjs deploy/required-env.json ./deploy/
# Docker initialises an empty named volume from the image directory's
# ownership, so the optimiser cache volume mounted here is writable by node.
RUN mkdir -p /app/apps/storefront/.next/cache && chown -R node:node /app/apps/storefront/.next/cache
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "node deploy/check-env.mjs storefront && exec node server.js"]
