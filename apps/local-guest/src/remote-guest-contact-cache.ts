import type { GuestContactStore } from "../../../packages/platform-core/src/accounts/account-contacts.js";
import type { GuestContact } from "../../../packages/platform-core/src/accounts/contact.js";
import { normalizeContactEmail, normalizeNigerianPhoneNumber } from "../../../packages/platform-core/src/accounts/contact.js";
import { GuestContactOwnedByAccountError } from "../../../packages/platform-core/src/accounts/account-contacts.js";

type PendingContactWrite =
  | { readonly kind: "phone"; readonly input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number } }
  | { readonly kind: "email"; readonly input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number } };

/** Synchronous projection cache for legacy domain handlers; every read is hydrated and every write drained over GuestDataPort. */
export class RemoteGuestContactCache implements GuestContactStore {
  #contact: GuestContact | null = null;
  #pending: PendingContactWrite | null = null;
  #failure: Error | null = null;

  hydrate(contact: GuestContact | null): void { this.#contact = contact; }
  failNextSave(error: Error): void { this.#failure = error; }
  takePending(): PendingContactWrite | null { const pending = this.#pending; this.#pending = null; return pending; }
  accept(contact: GuestContact): void { this.#contact = { ...contact, ...(this.#contact?.accountEmailOwned ? { accountEmailOwned: true } : {}) }; }

  find(guestId: string, tenantId: string): GuestContact | null {
    const row = this.#contact;
    return row?.guestId === guestId && row.tenantId === tenantId ? row : null;
  }

  savePhone(input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number }): GuestContact {
    if (this.#failure) { const error = this.#failure; this.#failure = null; throw error; }
    const current = this.find(input.guestId, input.tenantId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) throw new Error("Guest contact changed; refresh and try again");
    const phoneNumber = normalizeNigerianPhoneNumber(input.phoneNumber);
    if (phoneNumber === (current?.phoneNumber ?? null)) return current!;
    const contact = Object.freeze({ guestId: input.guestId, tenantId: input.tenantId, phoneNumber, contactEmail: current?.contactEmail ?? null, revision: (current?.revision ?? 0) + 1, ...(current?.accountEmailOwned ? { accountEmailOwned: true } : {}) });
    this.#contact = contact;
    this.#pending = { kind: "phone", input: { ...input, phoneNumber: contact.phoneNumber! } };
    return contact;
  }

  saveEmail(input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number }): GuestContact {
    if (this.#failure) { const error = this.#failure; this.#failure = null; throw error; }
    const current = this.find(input.guestId, input.tenantId);
    if (current?.accountEmailOwned) throw new GuestContactOwnedByAccountError();
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) throw new Error("Guest contact changed; refresh and try again");
    const contact = Object.freeze({ guestId: input.guestId, tenantId: input.tenantId, phoneNumber: current?.phoneNumber ?? null, contactEmail: normalizeContactEmail(input.contactEmail), revision: (current?.revision ?? 0) + 1 });
    this.#contact = contact;
    this.#pending = { kind: "email", input: { ...input, contactEmail: contact.contactEmail! } };
    return contact;
  }
}
