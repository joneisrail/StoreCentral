export function isPreviewEnabled(
  env: { NODE_ENV?: string } = process.env
): boolean {
  return env.NODE_ENV !== "production"
}
