import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { HumanHandoffApplication } from "./human-handoff-application.js";
export interface CheckoutReservationThreadLookup { getThreadId(reservationId: string): string | null; }
export function createCheckoutOverstayHumanHandoffPort(input: { readonly lookup: CheckoutReservationThreadLookup; readonly application: HumanHandoffApplication; readonly systemActor: CommandPrincipal }) {
  return { requestMandatoryHandoff({ reservationId }: { reservationId: string; actor: CommandPrincipal }): void { const threadId = input.lookup.getThreadId(reservationId); if (!threadId) throw new Error("Reservation interaction thread unavailable"); input.application.requestMandatoryHandoff({ threadId, trigger: "safety", category: "safety_or_access", actor: input.systemActor }); } };
}
