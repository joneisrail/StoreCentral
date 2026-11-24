type MedusaError = {
  // axios-style errors
  response?: {
    data: { message?: string } | string
    status: number
  }
  request?: unknown
  config?: { url: string; baseURL: string }
  // @medusajs/js-sdk FetchError
  status?: number
  statusText?: string
  message?: string
}

const sentence = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) {
    return "Something went wrong."
  }
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

/**
 * Turns whatever a Medusa call threw into an Error with a readable message.
 * Never returns, and never throws anything but an Error, so callers and error
 * boundaries always have a message to show. Headers and bodies are not logged
 * (they can carry cookies and customer data); only the status and URL are.
 */
export default function medusaError(error: unknown): never {
  const err = (error ?? {}) as MedusaError

  if (err.response) {
    const data = err.response.data
    const message =
      typeof data === "object" && data !== null
        ? data.message || "Request failed"
        : String(data ?? "Request failed")

    console.error(
      "Medusa request failed:",
      err.config?.url ?? "(unknown url)",
      err.response.status
    )
    throw new Error(sentence(message))
  }

  if (typeof err.status === "number") {
    console.error("Medusa request failed with status", err.status)
    throw new Error(sentence(err.message || err.statusText || "Request failed"))
  }

  if (err.request) {
    throw new Error("No response received from the store backend.")
  }

  throw new Error(sentence(err.message || "Error setting up the request"))
}
