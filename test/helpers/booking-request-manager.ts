import { InMemoryAuditLog } from "../../packages/platform-core/src/index.js";
import {
  UnitRepository,
  seedIssue01Units,
  GuestVerificationService,
  type GuestIdentityVerificationResultSource,
  RestrictedIdentityStore,
  BookingRequestManager,
  type SqliteGuestInteractionStore
} from "../../domains/shortlet/src/index.js";

import { createTestAvailabilityCalendar } from "./availability-calendar.js";

/**
 * A BookingRequestManager over the Issue 01 units with an in-memory calendar and audit (shared by domain tests).
 * Pass `store` to back the manager with a durable interaction store; omitted, it stays in memory as before.
 */
export function setupBookingRequestManager(options: { store?: SqliteGuestInteractionStore | null } = {}) {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = createTestAvailabilityCalendar({ repository, audit });
  const identityStore = new RestrictedIdentityStore();
  const verificationResults: GuestIdentityVerificationResultSource = {
    getVerificationResult: ({ tenantId, guestId }) => ({ tenantId, guestId, governmentIdVerified: true })
  };
  const guestVerification = new GuestVerificationService({ repository, verificationResults });
  const manager = new BookingRequestManager({
    repository,
    audit,
    calendar,
    guestVerification,
    store: options.store ?? null
  });
  const unit = repository.findAll()[0];
  return { repository, audit, calendar, identityStore, guestVerification, manager, unit };
}
