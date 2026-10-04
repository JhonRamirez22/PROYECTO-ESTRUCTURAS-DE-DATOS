import { describe, expect, it } from "vitest";
import { isMapStyleAuthorizationError } from "@/components/mapStyleFallback";

describe("isMapStyleAuthorizationError", () => {
  it.each([401, 403])("detects HTTP %i tile authorization failures", (status) => {
    expect(isMapStyleAuthorizationError({ error: { status } })).toBe(true);
  });

  it("detects a provider's API-key-required tile message", () => {
    expect(
      isMapStyleAuthorizationError({ error: new Error("API KEY REQUIRED") }),
    ).toBe(true);
  });

  it("does not switch map styles for unrelated errors", () => {
    expect(isMapStyleAuthorizationError({ error: new Error("tile timed out") })).toBe(false);
    expect(isMapStyleAuthorizationError({ message: "forbidden" })).toBe(false);
    expect(isMapStyleAuthorizationError(null)).toBe(false);
  });
});
