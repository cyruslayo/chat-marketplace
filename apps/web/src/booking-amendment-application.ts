import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingContract } from "../../../domains/shortlet/src/card-payment.js";
import type { BookingAmendmentChanges, BookingAmendmentManager, BookingAmendmentResult } from "../../../domains/shortlet/src/booking-amendment.js";
import { bookingAmendmentArtifactFromState, type BookingAmendmentArtifact } from "./booking-amendment-artifact.js";
export interface BookingAmendmentApplicationOptions { readonly manager: BookingAmendmentManager; readonly contracts: { getContract(id: string): BookingContract }; readonly clock?: () => Date; }
export class BookingAmendmentApplication { readonly #o: BookingAmendmentApplicationOptions; constructor(options: BookingAmendmentApplicationOptions) { this.#o = options; }
  getArtifact(contractId: string, principal: CommandPrincipal): BookingAmendmentArtifact { const contract = this.#o.contracts.getContract(contractId); return bookingAmendmentArtifactFromState(contract, this.#o.manager.getLatestForContract(contractId), principal); }
  requestAmendment(contractId: string, changes: BookingAmendmentChanges, principal: CommandPrincipal): BookingAmendmentArtifact { this.#o.manager.requestAmendment({ commandName: "booking_amendment.request", commandId: `request:${contractId}`, timestamp: (this.#o.clock ?? (() => new Date()))().toISOString(), principal, payload: { contractId, changes } }, this.#o.clock); return this.getArtifact(contractId, principal); }
  acceptAmendment(amendmentId: string, principal: CommandPrincipal) { return this.#o.manager.acceptAmendment(amendmentId, principal, this.#o.clock); }
  finalizeSettlement(amendmentId: string, principal: CommandPrincipal, settlement?: Parameters<BookingAmendmentManager["commitAmendment"]>[0]["payload"]["settlement"]): BookingAmendmentResult { return this.#o.manager.commitAmendment({ commandName: "booking_amendment.commit", commandId: `commit:${amendmentId}`, timestamp: (this.#o.clock ?? (() => new Date()))().toISOString(), principal, payload: { amendmentId, ...(settlement ? { settlement } : {}) } }, this.#o.clock); }
}
