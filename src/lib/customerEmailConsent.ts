export interface CustomerEmailConsent {
  customerEmail: string | null;
  emailNotificationsEnabled: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildCustomerEmailConsent(
  email: string,
  notificationsEnabled: boolean,
): CustomerEmailConsent | null {
  if (!notificationsEnabled) {
    return { customerEmail: null, emailNotificationsEnabled: false };
  }

  const normalizedEmail = email.trim();
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return null;
  }

  return { customerEmail: normalizedEmail, emailNotificationsEnabled: true };
}
