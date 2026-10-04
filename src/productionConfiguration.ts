const PLACEHOLDER_VALUES = new Set([
  "generate-a-unique-random-secret-of-at-least-32-bytes",
  "generate-a-unique-random-access-code-of-at-least-32-characters",
]);

const REQUIRED_PRODUCTION_AUTH_VARIABLES = [
  "AUTH_SECRET",
  "DISPATCHER_ACCESS_CODE",
] as const;

export function getProductionAuthConfigurationErrors(
  environment: Record<string, string | undefined>,
): string[] {
  return REQUIRED_PRODUCTION_AUTH_VARIABLES.filter((name) => {
    const value = environment[name]?.trim();
    return (
      value === undefined ||
      value.length < 32 ||
      PLACEHOLDER_VALUES.has(value)
    );
  });
}
