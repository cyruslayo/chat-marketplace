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

/**
 * Owner decision, 26 Nov 2026: the application may open before a privacy notice exists. "open" opens it (without the notice
 * link unless SHORTLET_PARTNER_PRIVACY_URL is also set); unset or "closed" leaves it to the notice address. Anything else
 * stops startup (fail closed).
 */
export function partnerApplicationsOpen(value: string | undefined): boolean {
  const setting = value?.trim() ?? "";
  if (setting === "" || setting === "closed") return false;
  if (setting === "open") return true;
  throw new Error("SHORTLET_PARTNER_APPLICATIONS must be open or closed");
}
