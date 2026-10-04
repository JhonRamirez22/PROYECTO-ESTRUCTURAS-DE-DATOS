export interface CustomerSmsConsent {
  customerPhone: string | null;
  smsNotificationsEnabled: boolean;
}

const COLOMBIAN_MOBILE_PATTERN = /^(?:\+?57)?3\d{9}$/;

export function buildCustomerSmsConsent(
  phone: string,
  notificationsEnabled: boolean,
): CustomerSmsConsent | null {
  if (!notificationsEnabled) {
    return { customerPhone: null, smsNotificationsEnabled: false };
  }

  const compactPhone = phone.trim().replace(/[\s().-]/g, "");
  if (!COLOMBIAN_MOBILE_PATTERN.test(compactPhone)) {
    return null;
  }

  const digits = compactPhone.replace(/^\+/, "");
  const nationalNumber = digits.startsWith("57") ? digits.slice(2) : digits;
  return { customerPhone: `+57${nationalNumber}`, smsNotificationsEnabled: true };
}
