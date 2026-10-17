import type { GuestContact } from "../../../packages/platform-core/src/accounts/contact.js";
import type { DurableGuestSessionBinding, DurableGuestThreadRecord } from "../../../domains/shortlet/src/guest-interaction-store.js";

/** Async seam for durable Guest identity/session/contact data owned by PLATFORM in Cloudflare. */
export interface GuestDataPort {
  saveSessionBinding(binding: DurableGuestSessionBinding): Promise<void>;
  findSessionBinding(sessionId: string): Promise<DurableGuestSessionBinding | null>;
  deleteSessionBinding(sessionId: string): Promise<void>;
  deleteSessionBindingsForPrincipals(principalIds: readonly string[], tenantId: string): Promise<void>;
  saveThread(thread: DurableGuestThreadRecord): Promise<void>;
  findThread(threadId: string): Promise<DurableGuestThreadRecord | null>;
  findThreadsForPrincipal(principalId: string, tenantId: string): Promise<DurableGuestThreadRecord[]>;
  findThreadsForPrincipals(principalIds: readonly string[], tenantId: string): Promise<DurableGuestThreadRecord[]>;
  findContact(guestId: string, tenantId: string): Promise<GuestContact | null>;
  savePhone(input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number }): Promise<GuestContact>;
  saveEmail(input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number }): Promise<GuestContact>;
}
