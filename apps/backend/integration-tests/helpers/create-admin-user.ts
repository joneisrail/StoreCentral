import type {
  IAuthModuleService,
  IUserModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  generateJwtToken,
  Modules,
} from "@medusajs/framework/utils"
import Scrypt from "scrypt-kdf"

/**
 * Creates (or reuses) a real admin user + emailpass auth identity via
 * the real User/Auth module services, then generates a real JWT the
 * same way Medusa's own login endpoint would -- not a mock, just a
 * faster path than a full POST /auth/user/emailpass round trip in every
 * test file. Adapted from StoreCentral's own first-party
 * integration-tests/helpers/create-admin-user.ts, trimmed of the RBAC
 * branch (not used in this project).
 */
export const createAdminUser = async (
  container: MedusaContainer,
  adminHeaders: { headers: Record<string, string> },
  options?: { email?: string }
) => {
  const email = options?.email ?? "admin@medusa.js"

  const userModule: IUserModuleService = container.resolve(Modules.USER)
  const authModule: IAuthModuleService = container.resolve(Modules.AUTH)

  const [existingUser] = await userModule.listUsers({ email })

  let user
  let authIdentity

  if (existingUser) {
    user = existingUser

    const existingAuthIdentities = await authModule.listAuthIdentities(
      {
        provider_identities: {
          entity_id: email,
          provider: "emailpass",
        },
      },
      { relations: ["provider_identities"] }
    )

    authIdentity = existingAuthIdentities[0]
  } else {
    user = await userModule.createUsers({
      first_name: "Admin",
      last_name: "User",
      email,
    })

    const hashConfig = { logN: 15, r: 8, p: 1 }
    const passwordHash = await Scrypt.kdf("somepassword", hashConfig)

    authIdentity = await authModule.createAuthIdentities({
      provider_identities: [
        {
          provider: "emailpass",
          entity_id: email,
          provider_metadata: {
            password: passwordHash.toString("base64"),
          },
        },
      ],
      app_metadata: {
        user_id: user.id,
      },
    })
  }

  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const { jwtSecret, jwtOptions } = config.projectConfig.http
  const token = generateJwtToken(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: authIdentity.id,
      auth_provider: "emailpass",
      app_metadata: { user: user.id },
    },
    { secret: jwtSecret, expiresIn: "1d", jwtOptions }
  )

  adminHeaders.headers["authorization"] = `Bearer ${token}`

  return { user, authIdentity }
}
