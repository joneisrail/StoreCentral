# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/pos.Dockerfile .
#
# apps/pos/server.js serves every file under its own directory, so that
# directory holds only server.js, index.html and package.json. The check-env
# files live one level up, outside the served directory.

FROM node:22-bookworm-slim
WORKDIR /srv/app
ENV NODE_ENV=production
COPY deploy/check-env.mjs deploy/required-env.json ./deploy/
COPY apps/pos/server.js apps/pos/index.html apps/pos/package.json ./pos/
USER node
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8001/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "node deploy/check-env.mjs pos && exec node pos/server.js"]
