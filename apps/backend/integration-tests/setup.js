const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core")
const { assertDisposableDatabase } = require("./guard-test-db")

MetadataStorage.clear()

// This guard is a backstop, not the main protection: it is inert when
// DB_TEMP_NAME is unset (the runner then makes its own medusa-* throwaway
// database).
//
// medusaIntegrationTestRunner names its own database medusa-<id>-integration-<n>,
// unless DB_TEMP_NAME overrides it. Assert any override is a throwaway name.
if (process.env.DB_TEMP_NAME) {
  assertDisposableDatabase(process.env.DB_TEMP_NAME)
}
