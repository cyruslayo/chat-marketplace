import type { HttpRequestLike } from "../../../packages/platform-core/src/http-like.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import {
  GUEST_ACCOUNT_POLICY_DEFAULTS,
  SqliteGuestAccountAuthority,
  type GuestAccountAuditSink,
  type GuestAccountPolicyOptions,
  type GuestAccountSession,
  type GuestAccountTelemetrySink,
} from "../../../domains/shortlet/src/guest-account-authority.js";
import { SqliteGuestAccountLinks, type GuestRequestContactIndex, type SignedInPrincipalResult } from "../../../domains/shortlet/src/guest-account-links.js";
import { GuestIdentityResolver, anonymousGuestIdentity, type GuestIdentity } from "../../../domains/shortlet/src/guest-identity.js";
import { normalizeContactEmail } from "../../../domains/shortlet/src/guest-contact.js";
import { ResendEmailSender, type EmailSender } from "../../../apps/pilot/src/notifications/email-sender.js";
import { guestSignInCodeMessage } from "../../../apps/pilot/src/notifications/pilot-notifier.js";

/** The account cookie (ADR 0093): opaque, HttpOnly, SameSite=Lax. It carries no account, email, tenant or permission. */
export const GUEST_ACCOUNT_COOKIE = "shortlet_guest_account";

/** The sign-in composition. A missing code-hashing key or sender disables account sign-in (fail closed). */
export interface GuestAccountComposition {
  /** The HMAC key for code and rate-scope hashing. Read from configuration; never defaulted. */
  readonly codeHashingKey?: string | null;
  /** The email provider the sign-in code goes through (ADR 0093). */
  readonly sender?: EmailSender | null;
  readonly audit?: GuestAccountAuditSink;
  readonly telemetry?: GuestAccountTelemetrySink;
  readonly policy?: GuestAccountPolicyOptions;
  /**
   * Trust `CF-Connecting-IP` for the client address (Cloudflare deployments only). Off by default: the socket address is
   * the only address used unless this is set explicitly.
   */
  readonly trustCloudflareClientAddress?: boolean;
}

/** Configuration names. The values are provided by the operator; nothing here supplies a default secret. */
export const GUEST_CODE_HASHING_KEY_ENV = "SHORTLET_GUEST_CODE_HASHING_KEY";
export const TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV = "SHORTLET_TRUST_CF_CONNECTING_IP";

/**
 * Reads the sign-in composition from configuration. The Resend sender uses the existing notifier names
 * (`RESEND_API_KEY`, `SHORTLET_NOTIFICATION_FROM`). A missing value leaves that part unset, so sign-in stays disabled.
 */
export function loadGuestAccountComposition(environment: Readonly<Record<string, string | undefined>>): GuestAccountComposition {
  const codeHashingKey = environment[GUEST_CODE_HASHING_KEY_ENV]?.trim() || null;
  const apiKey = environment.RESEND_API_KEY?.trim() ?? "";
  const from = environment.SHORTLET_NOTIFICATION_FROM?.trim() ?? "";
  const sender = apiKey && from ? new ResendEmailSender({ apiKey, from }) : null;
  return {
    codeHashingKey,
    sender,
    trustCloudflareClientAddress: environment[TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV] === "true",
  };
}

/** The account cookie's parts, from `<sessionId>.<secret>`. Anything else is not a credential. */
export interface GuestAccountCredentials {
  readonly sessionId: string;
  readonly sessionSecret: string;
}

export function parseAccountCookieValue(value: string | null | undefined): GuestAccountCredentials | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { sessionId: value.slice(0, separator), sessionSecret: value.slice(separator + 1) };
}

/** The account cookie a request carries, parsed. Absent or malformed means no account credentials. */
export function accountCredentialsOf(req: HttpRequestLike): GuestAccountCredentials | null {
  const header = req.headers.cookie;
  if (typeof header !== "string") return null;
  const prefix = `${GUEST_ACCOUNT_COOKIE}=`;
  const value = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  return parseAccountCookieValue(value);
}

/**
 * The address the rate limits key on (ADR 0093). The socket address is used unless Cloudflare is explicitly trusted, so
 * a forwarded header cannot be spoofed by a client. A request with no known address shares one bucket.
 */
export function clientAddressOf(req: HttpRequestLike, trustCloudflare: boolean): string {
  if (trustCloudflare) {
    const forwarded = req.headers["cf-connecting-ip"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  const socket = (req as { socket?: { remoteAddress?: string } }).socket;
  return typeof socket?.remoteAddress === "string" && socket.remoteAddress !== "" ? socket.remoteAddress : "unknown";
}

/** A safe same-origin path for `return` (AC6). Anything absolute, protocol-relative or off-site becomes `/`. */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  const base = "http://guest.invalid";
  try {
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

/** Thrown when the code was issued but the email could not be sent. Carries no provider text (ADR 0075). */
export class SignInDeliveryError extends Error {
  constructor() {
    super("The sign-in code could not be delivered");
    this.name = "SignInDeliveryError";
  }
}

export interface GuestAccountRuntimeOptions {
  readonly database: SqlDatabase;
  readonly tenantId: string;
  readonly clock: () => Date;
  readonly requests: GuestRequestContactIndex;
  readonly composition: GuestAccountComposition & { readonly codeHashingKey: string; readonly sender: EmailSender };
}

/**
 * Account sign-in, sign-out and identity resolution for one Guest server (issue 06). It composes the authority (codes and
 * sessions), the links (Linked Principals and claims) and the identity resolver over the composition's shared handle.
 */
export class GuestAccountRuntime {
  readonly authority: SqliteGuestAccountAuthority;
  readonly links: SqliteGuestAccountLinks;
  readonly #resolver: GuestIdentityResolver;
  readonly #sender: EmailSender;
  readonly #tenantId: string;
  readonly #trustCloudflare: boolean;
  readonly #lifetimeMinutes: number;

  constructor(options: GuestAccountRuntimeOptions) {
    const { composition } = options;
    this.authority = new SqliteGuestAccountAuthority(options.database, {
      codeHashingKey: composition.codeHashingKey,
      clock: options.clock,
      ...(composition.audit ? { audit: composition.audit } : {}),
      ...(composition.telemetry ? { telemetry: composition.telemetry } : {}),
      ...(composition.policy ? { policy: composition.policy } : {}),
    });
    this.links = new SqliteGuestAccountLinks(options.database, { requests: options.requests, authority: this.authority, clock: options.clock });
    this.#resolver = new GuestIdentityResolver(this.authority, this.links);
    this.#sender = composition.sender;
    this.#tenantId = options.tenantId;
    this.#trustCloudflare = composition.trustCloudflareClientAddress === true;
    const lifetimeMs = { ...GUEST_ACCOUNT_POLICY_DEFAULTS, ...composition.policy }.signInCodeLifetimeMs;
    this.#lifetimeMinutes = Math.round(lifetimeMs / 60_000);
  }

  get signInCodeLifetimeMinutes(): number {
    return this.#lifetimeMinutes;
  }

  clientAddress(req: HttpRequestLike): string {
    return clientAddressOf(req, this.#trustCloudflare);
  }

  /**
   * Issues a sign-in code and emails it (ADR 0093). The authority enforces the send limits and throws
   * `GuestAccountAuthorityError` with `rate_limited` when they are exceeded. A failed send leaves the challenge unused.
   */
  async requestSignInCode(input: { readonly email: string; readonly clientAddress: string }): Promise<{ readonly challengeId: string; readonly email: string }> {
    const email = normalizeContactEmail(input.email);
    const challenge = this.authority.requestCode({ tenantId: this.#tenantId, email, purpose: "sign_in", clientAddress: input.clientAddress });
    try {
      await this.#sender.send(
        guestSignInCodeMessage({ email, code: challenge.code, minutes: this.#lifetimeMinutes, challengeId: challenge.challengeId }),
      );
    } catch {
      throw new SignInDeliveryError();
    }
    return { challengeId: challenge.challengeId, email };
  }

  /** Checks a typed code (ADR 0093). Wrong, expired and exhausted codes throw the authority's own error codes. */
  verifySignInCode(input: { readonly challengeId: string; readonly email: string; readonly code: string; readonly clientAddress: string }): GuestAccountSession {
    const verified = this.authority.verifyCode({
      challengeId: input.challengeId,
      tenantId: this.#tenantId,
      email: input.email,
      code: input.code,
      purpose: "sign_in",
      clientAddress: input.clientAddress,
    });
    return verified;
  }

  /**
   * Links the device's principal to the account from the authority's verified session (ADR 0093). A conflicting link is
   * refused and the just-issued session is revoked, so a refused sign-in leaves no usable session behind.
   */
  linkVerifiedSignIn(principalId: string, session: GuestAccountSession): SignedInPrincipalResult {
    try {
      return this.links.linkSignedInPrincipal({ principalId, tenantId: this.#tenantId, session });
    } catch (error) {
      this.authority.revokeSession(session.sessionId, this.#tenantId);
      throw error;
    }
  }

  /** The identity a browser session has (ADR 0093): account authority only with a valid, linked account session. */
  identityFor(principalId: string, credentials: GuestAccountCredentials | null): GuestIdentity {
    if (credentials === null) return anonymousGuestIdentity(principalId, this.#tenantId);
    return this.#resolver.resolve({ principalId, tenantId: this.#tenantId, accountSession: credentials }) ?? anonymousGuestIdentity(principalId, this.#tenantId);
  }

  /** The verified account for a cookie, or null. Expired, revoked, malformed or foreign credentials resolve to null. */
  resolveAccount(credentials: GuestAccountCredentials | null): { readonly accountGuestId: string; readonly tenantId: string } | null {
    if (credentials === null) return null;
    const account = this.authority.resolveSession(credentials.sessionId, credentials.sessionSecret);
    if (!account || account.tenantId !== this.#tenantId) return null;
    return { accountGuestId: account.accountGuestId, tenantId: account.tenantId };
  }

  /** Revokes the account session behind a cookie (ADR 0093). A cookie that resolves to nothing revokes nothing. */
  signOut(credentials: GuestAccountCredentials | null): void {
    const account = this.resolveAccount(credentials);
    if (account && credentials) this.authority.revokeSession(credentials.sessionId, this.#tenantId);
  }

  /** The principals linked to an account, for retiring their interaction authority (ADR 0070). */
  principalsOf(accountGuestId: string): readonly string[] {
    return this.links.linkedPrincipals(accountGuestId, this.#tenantId);
  }

  /** Revokes every account session of the account (ADR 0093). Other accounts' sessions are untouched. */
  signOutEverywhere(accountGuestId: string): void {
    this.authority.revokeAllSessions(accountGuestId, this.#tenantId);
  }
}

