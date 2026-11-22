# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/backend.Dockerfile .
#
# The backend depends on the vendored Medusa packages through workspace:*
# links, so a production-only `npm install` inside .medusa/server cannot
# resolve them. The runtime image therefore keeps the built workspace
# (node_modules included) and starts Medusa from apps/backend/.medusa/server.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY . .
RUN yarn install --immutable
# Builds the CLI and the admin dashboard (dependencies of the backend) first,
# then `medusa build` for apps/backend. Same tasks as the root `build` script.
RUN yarn turbo run build build:plugin --filter=@dtc/backend...

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PATH="/app/apps/backend/node_modules/.bin:/app/node_modules/.bin:${PATH}"
# The workspace stays root-owned and read-only for the runtime user; only the
# server directory and its static (local file uploads) directory are writable.
COPY --from=build /app /app
WORKDIR /app/apps/backend/.medusa/server
COPY deploy/check-env.mjs deploy/required-env.json ./deploy/
RUN mkdir -p static && chown node:node . static
USER node
EXPOSE 9000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "node deploy/check-env.mjs backend && exec medusa start"]
