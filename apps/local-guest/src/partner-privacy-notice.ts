/**
 * The address of the privacy notice the founding partner application links to (landing issue 17). It is also the switch:
 * without one the application is closed and nothing is collected. A malformed value stops startup (fail closed).
 */
export function partnerPrivacyNoticeUrl(
  value: string | undefined,
): string | null {
  const setting = value?.trim() ?? "";
  if (setting === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(setting);
  } catch {
    throw new Error("SHORTLET_PARTNER_PRIVACY_URL must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("SHORTLET_PARTNER_PRIVACY_URL must be an absolute HTTPS URL");
  }
  return parsed.href;
}
