import { InMemoryAuditLog } from "../../packages/platform-core/src/index.js";
import {
  AvailabilityCalendar,
  UnitRepository,
  seedIssue01Units,
  GuestVerificationService,
  type GuestIdentityVerificationResultSource,
  RestrictedIdentityStore,
  BookingRequestManager
} from "../../domains/shortlet/src/index.js";

/** A BookingRequestManager over the Issue 01 units with an in-memory calendar and audit (shared by domain tests). */
export function setupBookingRequestManager() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const identityStore = new RestrictedIdentityStore();
  const verificationResults: GuestIdentityVerificationResultSource = {
    getVerificationResult: ({ tenantId, guestId }) => ({ tenantId, guestId, governmentIdVerified: true })
  };
  const guestVerification = new GuestVerificationService({ repository, verificationResults });
  const manager = new BookingRequestManager({
    repository,
    audit,
    calendar,
    guestVerification
  });
  const unit = repository.findAll()[0];
  return { repository, audit, calendar, identityStore, guestVerification, manager, unit };
}
