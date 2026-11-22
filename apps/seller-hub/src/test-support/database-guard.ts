const fail = (reason: string): never => {
  // Never include the URL itself: it may contain a password.
  throw new Error(
    `${reason} Set TEST_DATABASE_URL to a dedicated database whose name ends in "_test".`
  )
}

/**
 * Returns the url only when its database name ends in `_test`, so database
 * tests can never run against a real (dev or production) database.
 */
export const assertTestDatabase = (url: string | undefined): string => {
  if (!url) {
    return fail("TEST_DATABASE_URL is not set.")
  }
  let name: string
  try {
    const segments = new URL(url).pathname.split("/")
    name = decodeURIComponent(segments[segments.length - 1] ?? "")
  } catch {
    return fail("TEST_DATABASE_URL is not a valid connection string.")
  }
  if (!name.endsWith("_test")) {
    return fail("TEST_DATABASE_URL does not point at a test database.")
  }
  return url
}
