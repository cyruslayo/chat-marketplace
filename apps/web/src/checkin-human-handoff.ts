import type { CheckInHumanOwnershipPort, ComplaintCategory } from "../../../domains/shortlet/src/checkin-support.js";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { HumanHandoffApplication } from "./human-handoff-application.js";
export interface ReservationThreadLookup { getThreadId(reservationId: string): string; }
export class CheckInHumanHandoffAdapter implements CheckInHumanOwnershipPort {
  readonly #application: HumanHandoffApplication; readonly #lookup: ReservationThreadLookup; readonly #actor: CommandPrincipal;
  constructor(application: HumanHandoffApplication, lookup: ReservationThreadLookup, actor: CommandPrincipal = { id: "checkin-system", role: "system" }) { this.#application = application; this.#lookup = lookup; this.#actor = actor; }
  requestHumanOwnership(input: { reservationId: string; category: ComplaintCategory; minimizedContext: { readonly complaintId?: string; readonly safeSummary?: string } }): void { const threadId = this.#lookup.getThreadId(input.reservationId); const category = input.category === "access_failure" || input.category === "habitability_failure" || input.category === "safety_issue" ? "safety_or_access" : input.category === "substitution" ? "substitution" : "authority"; this.#application.requestMandatoryHandoff({ threadId, trigger: input.category === "access_failure" ? "failed_access" : "authority", category, actor: this.#actor }); }
}
