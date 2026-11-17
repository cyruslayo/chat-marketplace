import type { GuestContact } from "../../../packages/platform-core/src/accounts/contact.js";
import type { DurableGuestSessionBinding, DurableGuestThreadRecord } from "../../../domains/shortlet/src/index.js";
import type { LaneRestoreResult } from "../../../packages/platform-core/src/lane-restore.js";

/** Async seam for durable Guest identity/session/contact data owned by PLATFORM in Cloudflare. */
export interface GuestDataPort {
  saveSessionBinding(binding: DurableGuestSessionBinding): Promise<void>;
  findSessionBinding(sessionId: string): Promise<DurableGuestSessionBinding | null>;
  deleteSessionBinding(sessionId: string): Promise<void>;
  deleteSessionBindingsForPrincipals(principalIds: readonly string[], tenantId: string): Promise<void>;
  saveThread(thread: DurableGuestThreadRecord): Promise<void>;
  findThread(threadId: string): Promise<DurableGuestThreadRecord | null>;
  /** Issue 03h (ADR 0107 decision 11): one lane's rows for a cold restore. A refused lane comes back empty with its closed reason. */
  findLaneTimeline(threadId: string, tenantId: string, taskId: string, cap: number): Promise<LaneRestoreResult>;
  findThreadsForPrincipal(principalId: string, tenantId: string): Promise<DurableGuestThreadRecord[]>;
  findThreadsForPrincipals(principalIds: readonly string[], tenantId: string): Promise<DurableGuestThreadRecord[]>;
  findContact(guestId: string, tenantId: string): Promise<GuestContact | null>;
  savePhone(input: { guestId: string; tenantId: string; phoneNumber: string; expectedRevision?: number }): Promise<GuestContact>;
  saveEmail(input: { guestId: string; tenantId: string; contactEmail: string; expectedRevision?: number }): Promise<GuestContact>;
}
