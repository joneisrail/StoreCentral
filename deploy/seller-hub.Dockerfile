# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/seller-hub.Dockerfile .
# Only seller-hub's own dependencies are installed (yarn workspaces focus), not
# the whole Medusa monorepo.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY apps/seller-hub/package.json ./apps/seller-hub/
RUN yarn workspaces focus @dtc/seller-hub
COPY apps/seller-hub ./apps/seller-hub
RUN yarn workspace @dtc/seller-hub build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY apps/seller-hub/package.json ./apps/seller-hub/
RUN yarn workspaces focus --production @dtc/seller-hub
COPY --from=build /app/apps/seller-hub/dist ./apps/seller-hub/dist
WORKDIR /app/apps/seller-hub
COPY deploy/check-env.mjs deploy/required-env.json ./deploy/
USER node
EXPOSE 7005
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7005/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "node deploy/check-env.mjs seller-hub && exec node dist/index.js"]
