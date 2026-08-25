import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { CheckInSupportManager, type CheckInReservationProvider, type ComplaintCategory, type CheckInWindowProvider, type CheckInSupportAssignmentProvider } from "../../../domains/shortlet/src/checkin-support.js";
import { checkInSupportArtifactFromStatus, type CheckInSupportArtifact } from "./checkin-support-artifact.js";

export interface CheckInSupportApplicationOptions { readonly manager?: CheckInSupportManager; readonly windowProvider?: CheckInWindowProvider; readonly assignmentProvider?: CheckInSupportAssignmentProvider; readonly reservationProvider?: CheckInReservationProvider; readonly humanOwnership?: ConstructorParameters<typeof CheckInSupportManager>[0]["humanOwnership"]; readonly audit?: { record(entry: Record<string, unknown>): void }; readonly clock?: () => Date; }
export class CheckInSupportApplication {
  readonly manager: CheckInSupportManager; readonly #clock: () => Date;
  constructor(manager: CheckInSupportManager, clock: () => Date = () => new Date()) { this.manager = manager; this.#clock = clock; }
  getArtifact(reservationId: string, trustedViewer: CommandPrincipal, contract: { contractId: string; unitId: string }): CheckInSupportArtifact {
    return checkInSupportArtifactFromStatus({ status: this.manager.projectCheckInStatusForGuest(reservationId, trustedViewer), contractId: contract.contractId, unitId: contract.unitId, viewer: trustedViewer });
  }
  scheduleSupport(reservationId: string, principal: CommandPrincipal): void { this.manager.scheduleHumanSupport(createPlatformCommandEnvelope({ commandName: "checkin_support.schedule", principal, payload: { reservationId } }), this.#clock); }
  confirmGuestAccess(reservationId: string, principal: CommandPrincipal) { return this.manager.confirmGuestAccess(createPlatformCommandEnvelope({ commandName: "checkin_support.confirm_access", principal, payload: { reservationId } }), this.#clock); }
  reportGuestCheckInProblem(reservationId: string, category: ComplaintCategory, principal: CommandPrincipal, safeSummary?: string) { return this.manager.raiseBlockingComplaint(createPlatformCommandEnvelope({ commandName: "checkin_support.report_problem", principal, payload: { reservationId, category, ...(safeSummary ? { safeSummary } : {}) } }), this.#clock); }
  requestHumanSupport(reservationId: string, category: ComplaintCategory, principal: CommandPrincipal) { return this.manager.escalateIncident(createPlatformCommandEnvelope({ commandName: "checkin_support.escalate", principal, payload: { reservationId, category } }), this.#clock); }
  recordAccessSystemEvidence(input: { reservationId: string; provisionedAt: string; validAccess: boolean; failedAccess: boolean }, principal: CommandPrincipal) { return this.manager.recordAccessSystemEvidence(createPlatformCommandEnvelope({ commandName: "checkin_support.access_system_event", principal, payload: input }), this.#clock); }
  recordSupportVerification(input: { reservationId: string; provisionedAt?: string; validAccess: boolean; failedAccess: boolean; positiveAtContractualCheckIn: boolean }, principal: CommandPrincipal) { return this.manager.recordSupportVerification(createPlatformCommandEnvelope({ commandName: "checkin_support.support_verification", principal, payload: input }), this.#clock); }
}
export function createCheckInSupportApplication(options: CheckInSupportApplicationOptions): CheckInSupportApplication {
  const manager = options.manager ?? new CheckInSupportManager({ windowProvider: options.windowProvider!, assignmentProvider: options.assignmentProvider!, reservationProvider: options.reservationProvider, humanOwnership: options.humanOwnership, audit: options.audit });
  return new CheckInSupportApplication(manager, options.clock);
}
