export const DEFAULT_STORE_NAME = "Store"

export const getStoreName = (
  env: Record<string, string | undefined> = process.env
): string => {
  const name = env.NEXT_PUBLIC_STORE_NAME?.trim()
  return name ? name : DEFAULT_STORE_NAME
}
