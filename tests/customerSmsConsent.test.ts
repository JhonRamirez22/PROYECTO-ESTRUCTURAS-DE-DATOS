import { describe, expect, it } from "vitest";
import { buildCustomerSmsConsent } from "@/lib/customerSmsConsent";

describe("buildCustomerSmsConsent", () => {
  it("never sends or stores a phone without explicit consent", () => {
    expect(buildCustomerSmsConsent("300 123 4567", false)).toEqual({
      customerPhone: null,
      smsNotificationsEnabled: false,
    });
  });

  it("normalizes a local Colombian mobile number to E.164", () => {
    expect(buildCustomerSmsConsent(" 300 123 4567 ", true)).toEqual({
      customerPhone: "+573001234567",
      smsNotificationsEnabled: true,
    });
  });

  it("accepts an already international number and rejects non-Colombian/landline values", () => {
    expect(buildCustomerSmsConsent("+57 (300) 123-4567", true)?.customerPhone).toBe(
      "+573001234567",
    );
    expect(buildCustomerSmsConsent("+1 202 555 0100", true)).toBeNull();
    expect(buildCustomerSmsConsent("602 1234567", true)).toBeNull();
  });
});
