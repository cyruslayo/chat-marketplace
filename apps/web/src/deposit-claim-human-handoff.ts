import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { HumanHandoffApplication } from "./human-handoff-application.js";
import type { DepositClaimHandoff } from "./deposit-claim-application.js";
/** Narrow Issue 26 adapter over the existing HumanHandoffApplication; it does not create another manager. */
export function createDepositClaimHumanHandoffAdapter(input: { readonly application: HumanHandoffApplication; readonly threadForReservation: (reservationId: string) => string; readonly subjectActor: (reservationId: string) => CommandPrincipal }): DepositClaimHandoff {
  return { request: ({ reservationId }) => { input.application.requestMandatoryHandoff({ threadId: input.threadForReservation(reservationId), trigger: "material_refund", category: "deposit", actor: input.subjectActor(reservationId) }); } };
}
