import type { DatabaseSync } from "node:sqlite";

export interface GuestContact {
  readonly guestId: string;
  readonly tenantId: string;
  readonly phoneNumber: string | null;
  readonly contactEmail: string | null;
  readonly revision: number;
}

export interface GuestContactSource {
  find(guestId: string, tenantId: string): GuestContact | null;
}

const PHONE_MAX_INPUT_LENGTH = 32;
const EMAIL_MAX_LENGTH = 254;

export function normalizeNigerianPhoneNumber(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Phone number is required");
  if (trimmed.length > PHONE_MAX_INPUT_LENGTH) throw new Error("Phone number is too long");
  if (!/^[+\d\s().-]+$/.test(trimmed)) throw new Error("Enter a valid Nigerian phone number");
  const compact = trimmed.replace(/[\s().-]/g, "");
  const canonical = compact.startsWith("+234") ? compact : compact.startsWith("234") ? `+${compact}` : compact.startsWith("0") ? `+234${compact.slice(1)}` : "";
  if (!/^\+234[789]\d{9}$/.test(canonical)) throw new Error("Enter a valid Nigerian mobile number");
  return canonical;
}

export function normalizeContactEmail(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Email address is required");
  if (trimmed.length > EMAIL_MAX_LENGTH) throw new Error("Email address is too long");
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at !== trimmed.indexOf("@")) throw new Error("Enter a valid email address");
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (local.length > 64 || !/^[^\s@]+$/.test(local) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(domain) || domain.includes("..")) throw new Error("Enter a valid email address");
  return `${local}@${domain}`;
}

export class SqliteGuestContactRepository implements GuestContactSource {
  readonly #database: DatabaseSync;
  constructor(database: DatabaseSync) {
    this.#database = database;
    database.exec(`CREATE TABLE IF NOT EXISTS guest_contacts (
      guest_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      phone_number TEXT,
      contact_email TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guest_id, tenant_id)
    )`);
  }

  find(guestId: string, tenantId: string): GuestContact | null {
    const row = this.#database.prepare("SELECT * FROM guest_contacts WHERE guest_id = $guestId AND tenant_id = $tenantId").get({ $guestId: guestId, $tenantId: tenantId }) as { guest_id: string; tenant_id: string; phone_number: string | null; contact_email: string | null; revision: number } | undefined;
    return row ? Object.freeze({ guestId: row.guest_id, tenantId: row.tenant_id, phoneNumber: row.phone_number, contactEmail: row.contact_email, revision: row.revision }) : null;
  }

  savePhone(input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number }): GuestContact {
    return this.#save(input.guestId, input.tenantId, normalizeNigerianPhoneNumber(input.phoneNumber), undefined, input.expectedRevision);
  }

  saveEmail(input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number }): GuestContact {
    return this.#save(input.guestId, input.tenantId, undefined, normalizeContactEmail(input.contactEmail), input.expectedRevision);
  }

  #save(guestId: string, tenantId: string, phoneNumber: string | undefined, contactEmail: string | undefined, expectedRevision?: number): GuestContact {
    if (!guestId || !tenantId) throw new Error("Guest contact requires authoritative Guest and tenant context");
    const current = this.find(guestId, tenantId);
    if (expectedRevision !== undefined && expectedRevision !== (current?.revision ?? 0)) throw new Error("Guest contact is stale; refresh and try again");
    const nextPhone = phoneNumber ?? current?.phoneNumber ?? null;
    const nextEmail = contactEmail ?? current?.contactEmail ?? null;
    if (current?.phoneNumber === nextPhone && current?.contactEmail === nextEmail) return current;
    const revision = (current?.revision ?? 0) + 1;
    this.#database.prepare(`INSERT INTO guest_contacts (guest_id, tenant_id, phone_number, contact_email, revision)
      VALUES ($guestId, $tenantId, $phone, $email, $revision)
      ON CONFLICT(guest_id, tenant_id) DO UPDATE SET phone_number=excluded.phone_number, contact_email=excluded.contact_email, revision=excluded.revision`).run({ $guestId: guestId, $tenantId: tenantId, $phone: nextPhone, $email: nextEmail, $revision: revision });
    return Object.freeze({ guestId, tenantId, phoneNumber: nextPhone, contactEmail: nextEmail, revision });
  }
}
