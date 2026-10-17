import type { HttpRequestLike } from "../../../packages/platform-core/src/http-like.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import {
  GUEST_ACCOUNT_POLICY_DEFAULTS,
  GuestAccountAuthorityError,
  SqliteGuestAccountAuthority,
  type GuestAccount,
  type GuestAccountAuditSink,
  type GuestAccountPolicyOptions,
  type GuestAccountSession,
  type GuestAccountTelemetrySink,
} from "../../../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope } from "../../../packages/platform-core/src/envelope.js";
import { createPlatformAccounts } from "../../../packages/platform-core/src/accounts/accounts.js";
import { SqliteGuestAccountLinks, type AsyncGuestRequestContactIndex, type GuestRequestContactIndex, type SignedInPrincipalResult } from "../../../domains/shortlet/src/index.js";
import { GuestIdentityResolver, anonymousGuestIdentity, type GuestIdentity } from "../../../domains/shortlet/src/index.js";
import { normalizeContactEmail } from "../../../domains/shortlet/src/index.js";
import type { EmailSender } from "../../../apps/pilot/src/notifications/email-sender.js";
import { guestEmailChangeCodeMessage, guestSignInCodeMessage } from "../../../apps/pilot/src/notifications/pilot-notifier.js";
import { accountAssuranceInvalidator, accountAssuranceReader, type GuestAccountAssuranceInvalidator, type GuestAccountAssuranceReader } from "./guest-identity-status.js";
import type { AccountAssuranceStateReader } from "../../../domains/shortlet/src/guest-identity-assurance.js";
import { GUEST_CODE_HASHING_KEY_ENV, usableCodeHashingKey, type RemoteGuestAccounts } from "../../../packages/platform-core/src/accounts/remote-port.js";
import { TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV } from "./guest-account-composition.js";
export { TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV } from "./guest-account-composition.js";
export { loadGuestAccountComposition, type GuestAccountEnvironment } from "./guest-account-composition.js";
export { GUEST_CODE_HASHING_KEY_ENV, GUEST_CODE_HASHING_KEY_MIN_LENGTH, usableCodeHashingKey } from "../../../packages/platform-core/src/accounts/remote-port.js";

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
  readonly remoteAccounts?: RemoteGuestAccounts;
  readonly remoteAccountState?: AccountAssuranceStateReader;
  readonly remoteAssuranceInvalidator?: GuestAccountAssuranceInvalidator;
}

/** Configuration names. The values are provided by the operator; nothing here supplies a default secret. */
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

/** The path a Guest lands on when a `return` value is not safe (AC6). */
export const DEFAULT_RETURN_PATH = "/";

/**
 * Minimum length of the code-hashing key (Q7). Orchestrator choice: confirm or change (see the issue's Needs human list).
 * A shorter key disables sign-in rather than being used. There is no default key.
 */

/** A key the composition may use, or null: missing, or shorter than the minimum (fail closed, Q7). */
/** A single-slash local path: not protocol-relative, not backslash-led, no control characters or backslash. */
function isLocalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") && !/[\u0000-\u001f\u007f\\]/.test(path);
}

/**
 * A safe same-origin path for `return` (AC6, D1). The input is checked, then the URL-normalised output is checked again:
 * normalisation can turn an accepted input into a protocol-relative path ('/..//x' becomes '//x'), so the output is what
 * is redirected to. Anything else becomes the default path.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !isLocalPath(value)) return DEFAULT_RETURN_PATH;
  const base = "http://guest.invalid";
  let resolved: string;
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return DEFAULT_RETURN_PATH;
    resolved = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  return isLocalPath(resolved) ? resolved : DEFAULT_RETURN_PATH;
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
  readonly asyncRequests?: AsyncGuestRequestContactIndex;
  readonly accountState?: AccountAssuranceStateReader;
  readonly assuranceInvalidator?: GuestAccountAssuranceInvalidator;
  readonly composition: GuestAccountComposition & { readonly codeHashingKey: string; readonly sender: EmailSender };
  /** Optional remote PLATFORM authority. When supplied, this runtime never constructs account stores on its local DB. */
  readonly remoteAccounts?: RemoteGuestAccounts;
}

/**
 * Account sign-in, sign-out and identity resolution for one Guest server (issue 06). It composes the authority (codes and
 * sessions), the links (Linked Principals and claims) and the identity resolver over the composition's shared handle.
 */
export class GuestAccountRuntime {
  readonly authority: SqliteGuestAccountAuthority | RemoteGuestAccounts;
  readonly links: SqliteGuestAccountLinks | RemoteGuestAccounts;
  readonly #resolver: GuestIdentityResolver | null;
  readonly #assurance: GuestAccountAssuranceReader;
  readonly #assuranceInvalidator: GuestAccountAssuranceInvalidator;
  readonly #sender: EmailSender;
  readonly #tenantId: string;
  readonly #trustCloudflare: boolean;
  readonly #lifetimeMinutes: number;

  constructor(options: GuestAccountRuntimeOptions) {
    const { composition } = options;
    const accounts = options.remoteAccounts ? null : createPlatformAccounts({
      database: options.database,
      codeHashingKey: composition.codeHashingKey,
      clock: options.clock,
      requests: options.requests,
      ...(options.asyncRequests === undefined ? {} : { asyncRequests: options.asyncRequests }),
      ...(composition.audit ? { audit: composition.audit } : {}),
      ...(composition.telemetry ? { telemetry: composition.telemetry } : {}),
      ...(composition.policy ? { policy: composition.policy } : {}),
    });
    this.authority = options.remoteAccounts ?? accounts!.authority;
    this.links = options.remoteAccounts ?? accounts!.links;
    this.#assurance = accountAssuranceReader(options.database, options.clock, options.accountState ?? composition.remoteAccountState);
    this.#assuranceInvalidator = options.assuranceInvalidator ?? composition.remoteAssuranceInvalidator ?? accountAssuranceInvalidator(options.database);
    this.#resolver = accounts ? new GuestIdentityResolver(accounts.authority, accounts.links, this.#assurance) : null;
    this.#sender = composition.sender;
    this.#tenantId = options.tenantId;
    this.#trustCloudflare = composition.trustCloudflareClientAddress === true;
    const lifetimeMs = { ...GUEST_ACCOUNT_POLICY_DEFAULTS, ...composition.policy }.signInCodeLifetimeMs;
    this.#lifetimeMinutes = Math.round(lifetimeMs / 60_000);
  }

  get signInCodeLifetimeMinutes(): number {
    return this.#lifetimeMinutes;
  }

  get usesRemoteAuthority(): boolean { return !(this.authority instanceof SqliteGuestAccountAuthority); }

  clientAddress(req: HttpRequestLike): string {
    return clientAddressOf(req, this.#trustCloudflare);
  }

  /**
   * Issues a sign-in code and emails it (ADR 0093). The authority enforces the send limits and throws
   * `GuestAccountAuthorityError` with `rate_limited` when they are exceeded. A failed send leaves the challenge unused.
   */
  async requestSignInCode(input: { readonly email: string; readonly clientAddress: string }): Promise<{ readonly challengeId: string; readonly email: string }> {
    const email = normalizeContactEmail(input.email);
    const challenge = await this.authority.requestCode({ tenantId: this.#tenantId, email, purpose: "sign_in", clientAddress: input.clientAddress });
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
  async verifySignInCode(input: { readonly challengeId: string; readonly email: string; readonly code: string; readonly clientAddress: string }): Promise<GuestAccountSession> {
    if (!(this.authority instanceof SqliteGuestAccountAuthority)) {
      const result = await this.authority.verifyCode({ ...input, tenantId: this.#tenantId, purpose: "sign_in" });
      if (result.purpose !== "sign_in") throw new GuestAccountAuthorityError("code_invalid", "Sign-in code was not accepted");
      return result;
    }
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
  async linkVerifiedSignIn(principalId: string, session: GuestAccountSession): Promise<SignedInPrincipalResult> {
    try {
      return this.authority instanceof SqliteGuestAccountAuthority
        ? this.links.linkSignedInPrincipal({ principalId, tenantId: this.#tenantId, session })
        : await this.authority.linkSignedInPrincipal({ principalId, tenantId: this.#tenantId, session });
    } catch (error) {
      await this.authority.revokeSession(session.sessionId, this.#tenantId);
      throw error;
    }
  }

  /** Async variant for split platform/domain authorities; the contact lookup runs between two platform transactions. */
  async linkVerifiedSignInAcrossDomains(principalId: string, session: GuestAccountSession): Promise<SignedInPrincipalResult> {
    try {
      return this.authority instanceof SqliteGuestAccountAuthority
        ? await this.links.linkSignedInPrincipalWithLookup({ principalId, tenantId: this.#tenantId, session })
        : await this.authority.linkSignedInPrincipalWithLookup({ principalId, tenantId: this.#tenantId, session });
    } catch (error) {
      await this.authority.revokeSession(session.sessionId, this.#tenantId);
      throw error;
    }
  }

  /** The identity a browser session has (ADR 0093): account authority only with a valid, linked account session. */
  async identityFor(principalId: string, credentials: GuestAccountCredentials | null): Promise<GuestIdentity> {
    if (credentials === null) return anonymousGuestIdentity(principalId, this.#tenantId);
    if (!(this.authority instanceof SqliteGuestAccountAuthority)) {
      const account = await this.resolveAccount(credentials);
      const linked = await this.linkedAccountOf(principalId);
      if (!account || linked !== account.accountGuestId) return anonymousGuestIdentity(principalId, this.#tenantId);
      const principals = await this.principalsOf(account.accountGuestId);
      const claimedRequestIds = await this.authority.claimedRequestIds(account.accountGuestId, this.#tenantId);
      const governmentId = await this.#assurance.hasCurrentGovernmentIdWithCurrentEmail(account.accountGuestId, this.#tenantId);
      return { principalId, tenantId: this.#tenantId, accountGuestId: account.accountGuestId, assurance: governmentId ? "government-ID-verified" : "email-verified", principalIds: [principalId, ...principals.filter((id) => id !== principalId)], claimedRequestIds };
    }
    return this.#resolver?.resolve({ principalId, tenantId: this.#tenantId, accountSession: credentials }) ?? anonymousGuestIdentity(principalId, this.#tenantId);
  }

  identityForLocal(principalId: string, credentials: GuestAccountCredentials | null): GuestIdentity {
    if (this.#resolver) return this.#resolver.resolve({ principalId, tenantId: this.#tenantId, accountSession: credentials }) ?? anonymousGuestIdentity(principalId, this.#tenantId);
    return anonymousGuestIdentity(principalId, this.#tenantId);
  }

  /** The verified account for a cookie, or null. Expired, revoked, malformed or foreign credentials resolve to null. */
  async resolveAccount(credentials: GuestAccountCredentials | null): Promise<{ readonly accountGuestId: string; readonly tenantId: string } | null> {
    if (credentials === null) return null;
    const account = await this.authority.resolveSession(credentials.sessionId, credentials.sessionSecret);
    if (!account || account.tenantId !== this.#tenantId) return null;
    return { accountGuestId: account.accountGuestId, tenantId: account.tenantId };
  }

  /**
   * The account a signed-in browser holds, with whether its current government-ID result stands (issue 07, ADR 0094). The page
   * reads only this; the level is never a gate.
   */
  async accountStatus(accountGuestId: string): Promise<{ readonly account: GuestAccount; readonly governmentIdVerified: boolean } | null> {
    const account = await this.authority.findAccount(accountGuestId, this.#tenantId);
    if (account === null) return null;
    return { account, governmentIdVerified: await this.#assurance.hasCurrentGovernmentIdWithCurrentEmail(accountGuestId, this.#tenantId) };
  }

  /**
   * Sends the code for an email change to the NEW address (ADR 0093, `change_email` purpose). The session and the account revision
   * are checked by the authority; the authority also refuses the account's current address and enforces the send limits.
   */
  async requestEmailChangeCode(input: {
    readonly credentials: GuestAccountCredentials;
    readonly accountGuestId: string;
    readonly email: string;
    readonly clientAddress: string;
  }): Promise<{ readonly challengeId: string; readonly email: string }> {
    const email = normalizeContactEmail(input.email);
    const account = await this.authority.findAccount(input.accountGuestId, this.#tenantId);
    if (account === null) throw new GuestAccountAuthorityError("session_invalid", "A current Guest Account Session is required");
    const challenge = await this.authority.requestCode({
      tenantId: this.#tenantId,
      email,
      purpose: "change_email",
      clientAddress: input.clientAddress,
      accountGuestId: input.accountGuestId,
      sessionId: input.credentials.sessionId,
      sessionSecret: input.credentials.sessionSecret,
      expectedRevision: account.revision,
    });
    try {
      await this.#sender.send(guestEmailChangeCodeMessage({ email, code: challenge.code, minutes: this.#lifetimeMinutes, challengeId: challenge.challengeId }));
    } catch {
      throw new SignInDeliveryError();
    }
    return { challengeId: challenge.challengeId, email };
  }

  /**
   * Changes the account email only after the code sent to the new address is entered (issue 07 AC2, ADR 0072). A wrong, expired or
   * replayed code throws the authority's own error and changes nothing. The change is a platform command with its own proof.
   */
  async confirmEmailChange(input: {
    readonly credentials: GuestAccountCredentials;
    readonly accountGuestId: string;
    readonly challengeId: string;
    readonly email: string;
    readonly code: string;
    readonly clientAddress: string;
  }): Promise<GuestAccount> {
    const email = normalizeContactEmail(input.email);
    let account: GuestAccount;
    try {
      const verified = await this.authority.verifyCode({
        challengeId: input.challengeId, tenantId: this.#tenantId, email, code: input.code, purpose: "change_email",
        clientAddress: input.clientAddress, accountGuestId: input.accountGuestId,
        sessionId: input.credentials.sessionId, sessionSecret: input.credentials.sessionSecret,
      });
      if (!("proof" in verified)) throw new GuestAccountAuthorityError("invalid_input", "Email-change proof was not returned");
      const command = createPlatformCommandEnvelope({
        commandName: "guest_account.change_email",
        principal: { id: input.accountGuestId, role: "guest", tenantId: this.#tenantId },
        payload: { email }, idempotencyKey: `guest_account.change_email:${input.challengeId}`,
        expectedVersion: verified.proof.accountRevision,
      });
      account = await this.authority.changeEmail({ command, proof: verified.proof, sessionSecret: input.credentials.sessionSecret });
    } catch (error) {
      // A retry may only replay a committed, code-proven command. Rejected commands still fail without Shortlet mutation.
      if (!(error instanceof GuestAccountAuthorityError)) throw error;
      try {
        account = await this.authority.replayEmailChange({
          tenantId: this.#tenantId, accountGuestId: input.accountGuestId, sessionId: input.credentials.sessionId,
          sessionSecret: input.credentials.sessionSecret, challengeId: input.challengeId, email, code: input.code,
        });
      } catch {
        throw error;
      }
    }
    await this.#assuranceInvalidator.invalidateGuestIdentityAssurance({ tenantId: this.#tenantId, accountGuestId: account.accountGuestId });
    await this.authority.markEmailChangeAssuranceCleanupComplete({ tenantId: this.#tenantId, accountGuestId: account.accountGuestId, challengeId: input.challengeId });
    return account;
  }

  /** Revokes the account session behind a cookie (ADR 0093). A cookie that resolves to nothing revokes nothing. */
  async signOut(credentials: GuestAccountCredentials | null): Promise<void> {
    const account = await this.resolveAccount(credentials);
    if (account && credentials) await this.authority.revokeSession(credentials.sessionId, this.#tenantId);
  }

  /** The account a Linked Principal belongs to in this tenant, or null (review D4: the interaction principal must agree with the account). */
  async linkedAccountOf(principalId: string): Promise<string | null> {
    const link = await (this.authority instanceof SqliteGuestAccountAuthority ? this.links.accountForPrincipal(principalId) : this.authority.accountForPrincipal(principalId));
    return link !== null && link.tenantId === this.#tenantId ? link.accountGuestId : null;
  }

  /** The principals linked to an account, for retiring their interaction authority (ADR 0070). */
  async principalsOf(accountGuestId: string): Promise<readonly string[]> {
    return this.authority instanceof SqliteGuestAccountAuthority ? this.links.linkedPrincipals(accountGuestId, this.#tenantId) : this.authority.linkedPrincipals(accountGuestId, this.#tenantId);
  }

  /** Revokes every account session of the account (ADR 0093). Other accounts' sessions are untouched. */
  async signOutEverywhere(accountGuestId: string): Promise<void> {
    await this.authority.revokeAllSessions(accountGuestId, this.#tenantId);
  }
}

