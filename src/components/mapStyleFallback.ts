export function isMapStyleAuthorizationError(event: unknown): boolean {
  if (typeof event !== "object" || event === null || !("error" in event)) {
    return false;
  }

  const error = event.error;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");

  return (
    status === 401 ||
    status === 403 ||
    /\b(?:401|403)\b|unauthorized|forbidden|api[ _-]?key required/i.test(message)
  );
}
