import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import type { GuestContact, GuestContactSource } from "./guest-contact.js";

/**
 * The contact store operations the account projection wraps. `SqliteGuestContactRepository` satisfies it.
 */
export interface GuestContactStore extends GuestContactSource {
  savePhone(input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number }): GuestContact;
  saveEmail(input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number }): GuestContact;
}

/**
 * Thrown when a linked principal tries to save a contact email. The account email is owned by the Guest Account and changed only
 * through its code-verified change (ADR 0072, ADR 0093, issue 07). The message names no address.
 */
export class GuestContactOwnedByAccountError extends Error {
  constructor() {
    super("The contact email is the account email");
    this.name = "GuestContactOwnedByAccountError";
  }
}

interface LinkRow {
  account_guest_id: unknown;
}

interface AccountEmailRow {
  email_normalized: unknown;
  status: unknown;
}

/**
 * The single contact view for a Guest session (issue 07, the contact-details decision). The Guest Account owns the email, so for a
 * linked principal the contact email is the account's active email and is never written here. The phone is written to the
 * account's contact row and read from it first, falling back to the principal's own row (phone and name stay in `guest_contacts`).
 * An anonymous principal reads and writes its own row exactly as before. New Booking Requests snapshot whatever this view returns,
 * and existing requests keep their snapshot (ADR 0004).
 */
export class GuestAccountContacts implements GuestContactStore {
  readonly #database: SqlDatabase;
  readonly #contacts: GuestContactStore;

  constructor({ database, contacts }: { database: SqlDatabase; contacts: GuestContactStore }) {
    this.#database = database;
    this.#contacts = contacts;
  }

  find(guestId: string, tenantId: string): GuestContact | null {
    const accountGuestId = this.#linkedAccountOf(guestId, tenantId);
    const own = this.#contacts.find(guestId, tenantId);
    if (accountGuestId === null) return own;
    const accountRow = this.#contacts.find(accountGuestId, tenantId);
    return Object.freeze({
      guestId,
      tenantId,
      phoneNumber: accountRow?.phoneNumber ?? own?.phoneNumber ?? null,
      contactEmail: this.#activeAccountEmail(accountGuestId, tenantId),
      revision: accountRow?.revision ?? 0,
    });
  }

  savePhone(input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number }): GuestContact {
    const accountGuestId = this.#linkedAccountOf(input.guestId, input.tenantId);
    return this.#contacts.savePhone(accountGuestId === null ? input : { ...input, guestId: accountGuestId });
  }

  saveEmail(input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number }): GuestContact {
    if (this.#linkedAccountOf(input.guestId, input.tenantId) !== null) throw new GuestContactOwnedByAccountError();
    return this.#contacts.saveEmail(input);
  }

  /** The account a principal is linked to in this tenant, or null (no link, no table, or another tenant). Fails closed. */
  #linkedAccountOf(principalId: string, tenantId: string): string | null {
    if (!this.#hasTable("guest_account_principals")) return null;
    const row = this.#database
      .prepare("SELECT account_guest_id FROM guest_account_principals WHERE principal_id = ? AND tenant_id = ?")
      .get([principalId, tenantId]) as unknown as LinkRow | undefined;
    return typeof row?.account_guest_id === "string" && row.account_guest_id !== "" ? row.account_guest_id : null;
  }

  /** The account's email while it is active; a closed or missing account has no contact email (fail closed). */
  #activeAccountEmail(accountGuestId: string, tenantId: string): string | null {
    if (!this.#hasTable("guest_accounts")) return null;
    const row = this.#database
      .prepare("SELECT email_normalized, status FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?")
      .get([accountGuestId, tenantId]) as unknown as AccountEmailRow | undefined;
    if (row?.status !== "active" || typeof row.email_normalized !== "string") return null;
    return row.email_normalized;
  }

  #hasTable(name: string): boolean {
    return this.#database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get([name]) !== undefined;
  }
}
