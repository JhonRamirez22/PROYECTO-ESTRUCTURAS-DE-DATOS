import { describe, expect, it } from "vitest";
import { buildCustomerEmailConsent } from "@/lib/customerEmailConsent";

describe("buildCustomerEmailConsent", () => {
  it("never sends or stores an email without explicit consent", () => {
    expect(buildCustomerEmailConsent("cliente@example.com", false)).toEqual({
      customerEmail: null,
      emailNotificationsEnabled: false,
    });
  });

  it("trims and includes a valid email when the customer opted in", () => {
    expect(buildCustomerEmailConsent("  cliente@example.com  ", true)).toEqual({
      customerEmail: "cliente@example.com",
      emailNotificationsEnabled: true,
    });
  });

  it("rejects invalid email when notifications were requested", () => {
    expect(buildCustomerEmailConsent("no-es-correo", true)).toBeNull();
  });
});
