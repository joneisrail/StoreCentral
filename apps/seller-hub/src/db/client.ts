import { Pool } from "pg"
import type { SellerHubEnv } from "../env.js"

/**
 * Creates a `pg` connection pool for seller-hub's own `seller_hub` schema,
 * using the same Postgres instance/database as the Medusa backend.
 */
export const createPool = (env: SellerHubEnv): Pool => {
  return new Pool({ connectionString: env.databaseUrl })
}
