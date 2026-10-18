import type { SqlDatabase } from "../sql-database.js";
import { SqliteGuestAccountAuthority, type GuestAccountAuditSink, type GuestAccountPolicyOptions, type GuestAccountTelemetrySink } from "./authority.js";
import { SqliteGuestAccountLinks, type AsyncGuestRequestContactIndex, type GuestRequestContactIndex } from "./links.js";

/**
 * Platform Accounts (ADR 0093, amended by ADR 0101): the sign-in-by-emailed-code authority, the linked principals and
 * scoped request claims, and the contact store. The platform owns account state and authorization; a domain pack
 * consumes this module and never reaches into its tables. The "Guest" vocabulary stays with the shortlet pack.
 */

export interface Accounts {
  /** Sign-in codes, account sessions and the email change (ADR 0093). */
  readonly authority: SqliteGuestAccountAuthority;
  /** Linked principals and resource-scoped request claims (ADR 0093). */
  readonly links: SqliteGuestAccountLinks;
}

export interface PlatformAccountsOptions {
  readonly database: SqlDatabase;
  readonly tenantId?: string;
  /** The HMAC key for code and rate-scope hashing. Read from configuration; never defaulted (ADR 0093). */
  readonly codeHashingKey: string;
  readonly clock?: () => Date;
  readonly audit?: GuestAccountAuditSink;
  readonly telemetry?: GuestAccountTelemetrySink;
  readonly policy?: GuestAccountPolicyOptions;
  /** The immutable Booking Request contact index claims are matched against (ADR 0093). */
  readonly requests: GuestRequestContactIndex;
  readonly asyncRequests?: AsyncGuestRequestContactIndex;
}

/** Composes the account authority and links over one shared handle. */
export function createPlatformAccounts(options: PlatformAccountsOptions): Accounts {
  const authority = new SqliteGuestAccountAuthority(options.database, {
    codeHashingKey: options.codeHashingKey,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
  const links = new SqliteGuestAccountLinks(options.database, {
    requests: options.requests,
    ...(options.asyncRequests === undefined ? {} : { asyncRequests: options.asyncRequests }),
    authority,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return { authority, links };
}
