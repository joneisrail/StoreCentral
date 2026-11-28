import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { buildRuntimeModules } from './src/config/runtime-modules'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Redis event bus / workflow engine / locking, only when BACKEND_REDIS_MODULES=true.
const runtime = buildRuntimeModules(process.env)

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    ...(runtime.redisUrl ? { redisUrl: runtime.redisUrl } : {}),
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [
    {
      resolve: './src/modules/review',
    },
    {
      resolve: './src/modules/search-insights',
    },
    {
      resolve: './src/modules/order-events',
    },
    {
      resolve: './src/modules/channel-offers',
    },
    {
      resolve: './src/modules/supplier',
    },
    {
      resolve: './src/modules/purchase',
    },
    {
      resolve: './src/modules/accounting',
    },
    {
      // Registering the Fulfillment Module explicitly (rather than letting
      // Medusa fall back to its implicit default) so we can add the
      // EasyPost provider alongside the existing manual one. The manual
      // provider is re-declared here on purpose: Medusa does not merge a
      // custom `providers` list with the defaults, it replaces them, and
      // the seed data (src/migration-scripts/initial-data-seed.ts,
      // src/scripts/setup-us-market.ts) already has shipping options on
      // `manual_manual` -- dropping it here would break them.
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/fulfillment-manual',
            id: 'manual',
          },
          {
            // @dtc/fulfillment-easypost: file dependency resolves to a
            // worktree of the StoreCentral repo (see apps/backend/package.json),
            // not its main checkout -- see the comment there for why.
            resolve: '@dtc/fulfillment-easypost',
            id: 'easypost',
            options: {
              apiKey: process.env.EASYPOST_API_KEY,
              defaultParcel: {
                weight: Number(process.env.EASYPOST_DEFAULT_PARCEL_WEIGHT ?? 16),
                length: Number(process.env.EASYPOST_DEFAULT_PARCEL_LENGTH ?? 10),
                width: Number(process.env.EASYPOST_DEFAULT_PARCEL_WIDTH ?? 8),
                height: Number(process.env.EASYPOST_DEFAULT_PARCEL_HEIGHT ?? 4),
              },
            },
          },
        ],
      },
    },
    {
      // Registering the Search Module explicitly replaces Medusa's default
      // entry (Postgres provider only). Meilisearch serves every index that
      // names no provider. The Postgres provider is re-declared on purpose:
      // indexes built on it before this change are recorded against
      // "search-postgres", and the module drops those old versions during
      // `db:migrate` through that provider. Without it the drop fails, the
      // old records are retried on every migration and their tables stay.
      resolve: '@medusajs/medusa/search',
      options: {
        providers: [
          {
            resolve: './src/providers/search-meilisearch',
            id: 'meilisearch',
            options: {
              host: process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700',
              apiKey: process.env.MEILISEARCH_API_KEY,
              timeout: 3000,
            },
          },
          {
            resolve: '@medusajs/medusa/search-postgres',
            id: 'postgres',
            options: { engine: 'native' },
          },
        ],
        default_provider: 'meilisearch',
      },
    },
    ...runtime.modules,
  ],
})
