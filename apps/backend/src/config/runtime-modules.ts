import type { InputConfigModules } from "@medusajs/framework/types"

type RuntimeEnv = {
  BACKEND_REDIS_MODULES?: string
  REDIS_URL?: string
}

type RuntimeModules = {
  modules: InputConfigModules
  redisUrl?: string
}

/**
 * Builds the Redis-backed runtime modules (event bus, workflow engine,
 * locking). Off unless BACKEND_REDIS_MODULES is exactly "true", so the
 * default in-memory modules (and `yarn dev`) are unchanged.
 */
export function buildRuntimeModules(env: RuntimeEnv): RuntimeModules {
  if (env.BACKEND_REDIS_MODULES !== "true") {
    return { modules: [] }
  }

  const redisUrl = env.REDIS_URL
  if (!redisUrl) {
    throw new Error("BACKEND_REDIS_MODULES=true requires REDIS_URL")
  }

  return {
    modules: [
      {
        resolve: "@medusajs/medusa/event-bus-redis",
        options: { redisUrl },
      },
      {
        resolve: "@medusajs/medusa/workflow-engine-redis",
        options: { redis: { redisUrl } },
      },
      {
        resolve: "@medusajs/medusa/locking",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/locking-redis",
              id: "locking-redis",
              is_default: true,
              options: { redisUrl },
            },
          ],
        },
      },
    ],
    redisUrl,
  }
}
