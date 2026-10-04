import { describe, expect, it } from "vitest";
import { getProductionAuthConfigurationErrors } from "@/lib/auth/productionConfiguration";

describe("getProductionAuthConfigurationErrors", () => {
  it("acepta secretos privados de al menos 32 caracteres", () => {
    expect(
      getProductionAuthConfigurationErrors({
        AUTH_SECRET: "a".repeat(48),
        DISPATCHER_ACCESS_CODE: "b".repeat(48),
      }),
    ).toEqual([]);
  });

  it("rechaza valores faltantes, cortos y placeholders sin exponer su contenido", () => {
    expect(
      getProductionAuthConfigurationErrors({
        AUTH_SECRET: "short",
        DISPATCHER_ACCESS_CODE:
          "generate-a-unique-random-access-code-of-at-least-32-characters",
      }),
    ).toEqual(["AUTH_SECRET", "DISPATCHER_ACCESS_CODE"]);
  });
});
