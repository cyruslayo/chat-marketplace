import type { GuestContact, GuestContactStore } from "../../../domains/shortlet/src/index.js";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";

export class GuestContactApplication {
  /** The single contact view: an account-aware store over `guest_contacts` (issue 07). */
  readonly repository: GuestContactStore;
  constructor(repository: GuestContactStore) { this.repository = repository; }

  get(principal: CommandPrincipal): GuestContact | null {
    const { guestId, tenantId } = this.#guestContext(principal);
    return this.repository.find(guestId, tenantId);
  }

  submitPhone(input: { readonly phoneNumber: string; readonly expectedRevision?: number }, principal: CommandPrincipal): GuestContact {
    const { guestId, tenantId } = this.#guestContext(principal);
    return this.repository.savePhone({ guestId, tenantId, phoneNumber: input.phoneNumber, ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}) });
  }

  submitEmail(input: { readonly contactEmail: string; readonly expectedRevision?: number }, principal: CommandPrincipal): GuestContact {
    const { guestId, tenantId } = this.#guestContext(principal);
    return this.repository.saveEmail({ guestId, tenantId, contactEmail: input.contactEmail, ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}) });
  }

  #guestContext(principal: CommandPrincipal): { guestId: string; tenantId: string } {
    if (principal.role !== "guest" || !principal.id || !principal.tenantId) throw new Error("Guest contact requires an authoritative Guest session");
    return { guestId: principal.id, tenantId: principal.tenantId };
  }
}
