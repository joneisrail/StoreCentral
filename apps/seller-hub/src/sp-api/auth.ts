export type RefreshAccessTokenInput = {
  refreshToken: string
  clientId: string
  clientSecret: string
}

export type AccessTokenResult = {
  accessToken: string
  expiresAt: number
}

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

/**
 * Exchanges a long-lived SP-API refresh token for a short-lived LWA access
 * token using the OAuth `refresh_token` grant.
 */
export const refreshAccessToken = async (
  input: RefreshAccessTokenInput,
  fetchImpl: typeof fetch
): Promise<AccessTokenResult> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })

  const response = await fetchImpl(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorBody = await readBodySafely(response)
    throw new Error(
      `LWA token refresh failed with status ${response.status}: ${errorBody}`
    )
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

const readBodySafely = async (response: Response): Promise<string> => {
  try {
    const body = await response.json()
    return JSON.stringify(body)
  } catch {
    return ""
  }
}
