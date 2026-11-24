const c = require("ansi-colors")

const requiredEnvs = [
  {
    key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    description:
      "Learn how to create a publishable key: https://docs.medusajs.com/v2/resources/storefront-development/publishable-api-keys",
  },
  {
    key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
    description:
      "URL of the Medusa backend. Without it the storefront would call http://localhost:9000, which is only right on a developer machine.",
    productionOnly: true,
  },
]

// Anything starting with NEXT_PUBLIC_ is bundled into the browser. Publishable
// keys are meant for that; names that read as secrets are not.
const SECRET_NAME = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|ADMIN_KEY)/i

/**
 * Pure check so it can be tested: returns the missing required variables and
 * the NEXT_PUBLIC_ names that look like secrets.
 */
function findEnvProblems(env) {
  const production = env.NODE_ENV === "production"
  const missing = requiredEnvs.filter(
    (e) => (!e.productionOnly || production) && !env[e.key]
  )
  const exposedSecrets = Object.keys(env).filter(
    (key) => key.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(key)
  )
  return { missing, exposedSecrets }
}

function checkEnvVariables() {
  const { missing, exposedSecrets } = findEnvProblems(process.env)

  if (missing.length > 0) {
    console.error(
      c.red.bold("\nError: Missing required environment variables\n")
    )

    missing.forEach(function (env) {
      console.error(c.yellow(`  ${c.bold(env.key)}`))
      if (env.description) {
        console.error(c.dim(`    ${env.description}\n`))
      }
    })

    console.error(
      c.yellow(
        "\nPlease set these variables in your .env file or environment before starting the application.\n"
      )
    )
  }

  if (exposedSecrets.length > 0) {
    console.error(
      c.red.bold("\nError: Secret-looking variables would reach the browser\n")
    )
    exposedSecrets.forEach(function (key) {
      console.error(c.yellow(`  ${c.bold(key)}`))
    })
    console.error(
      c.yellow(
        "\nVariables starting with NEXT_PUBLIC_ are bundled into client code. Rename the variable (no NEXT_PUBLIC_ prefix) and read it on the server only.\n"
      )
    )
  }

  if (missing.length > 0 || exposedSecrets.length > 0) {
    process.exit(1)
  }
}

module.exports = checkEnvVariables
module.exports.findEnvProblems = findEnvProblems
