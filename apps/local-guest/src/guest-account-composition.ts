import { ResendEmailSender, type EmailSender } from "../../../apps/pilot/src/notifications/email-sender.js";
import { GUEST_CODE_HASHING_KEY_ENV, usableCodeHashingKey } from "../../../packages/platform-core/src/accounts/remote-port.js";
export { GUEST_CODE_HASHING_KEY_ENV } from "../../../packages/platform-core/src/accounts/remote-port.js";

export const TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV = "SHORTLET_TRUST_CF_CONNECTING_IP";

export interface GuestAccountEnvironment {
  readonly SHORTLET_GUEST_CODE_HASHING_KEY?: string;
  readonly RESEND_API_KEY?: string;
  readonly SHORTLET_NOTIFICATION_FROM?: string;
  readonly SHORTLET_TRUST_CF_CONNECTING_IP?: string;
}

export interface GuestAccountCompositionConfig {
  readonly codeHashingKey?: string | null;
  readonly sender?: EmailSender | null;
  readonly trustCloudflareClientAddress?: boolean;
}

/** Builds only configuration dependencies; the account runtime and assurance graph remain outside the Worker composition root. */
export function loadGuestAccountComposition(environment: GuestAccountEnvironment): GuestAccountCompositionConfig {
  const codeHashingKey = usableCodeHashingKey(environment[GUEST_CODE_HASHING_KEY_ENV]?.trim() || null);
  const apiKey = environment.RESEND_API_KEY?.trim() ?? "";
  const from = environment.SHORTLET_NOTIFICATION_FROM?.trim() ?? "";
  const sender = apiKey && from ? new ResendEmailSender({ apiKey, from }) : null;
  return {
    codeHashingKey,
    sender,
    trustCloudflareClientAddress: environment[TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV] === "true",
  };
}
