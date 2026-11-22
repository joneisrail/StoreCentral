// Medusa's test runner creates throwaway databases named
// medusa-<id>-integration-<n>. Refuse anything else so a misconfigured
// environment can never point integration tests at a real database.
// The message never includes the name or any connection string.
function assertDisposableDatabase(dbName) {
  const ok =
    typeof dbName === "string" &&
    (dbName.startsWith("medusa-") || dbName.endsWith("_test"))

  if (!ok) {
    throw new Error(
      "Refusing to run integration tests: the database is not a throwaway test database (expected a name starting with medusa- or ending with _test)."
    )
  }
}

module.exports = { assertDisposableDatabase }
