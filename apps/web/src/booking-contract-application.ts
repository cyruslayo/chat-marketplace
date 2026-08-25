import { ContractAndArrivalReleaseManager, type ContractRepository, type ProtectedArrivalView, type ArrivalReleaseAudit } from "../../../domains/shortlet/src/index.js";
import type { ArrivalDisclosurePolicy } from "../../../domains/shortlet/src/arrival-disclosure-policy.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { bookingContractArtifactFromView, type BookingContractArtifact } from "./booking-contract-artifact.js";

export interface BookingContractApplicationOptions {
  readonly repository: ContractRepository;
  readonly policy?: ArrivalDisclosurePolicy;
  readonly audit?: ArrivalReleaseAudit;
  readonly clock?: () => Date;
}

export class BookingContractApplication {
  readonly manager: ContractAndArrivalReleaseManager;
  readonly #clock: () => Date;

  constructor(manager: ContractAndArrivalReleaseManager, clock: () => Date = () => new Date()) {
    this.manager = manager;
    this.#clock = clock;
  }

  getArtifact(contractId: string, trustedViewer: CommandPrincipal): BookingContractArtifact {
    const envelope = createPlatformCommandEnvelope({ commandName: "contract.get_view", principal: trustedViewer, payload: { contractId } });
    const trustedEnvelope = { ...envelope, timestamp: this.#clock().toISOString() };
    const view = this.manager.getBookingContractView(trustedEnvelope);
    const contract = this.manager.getAuthorizedContractForApplication(trustedEnvelope);
    return bookingContractArtifactFromView(view, contract, trustedViewer);
  }

  getProtectedArrivalView(contractId: string, trustedViewer: CommandPrincipal): ProtectedArrivalView {
    const envelope = createPlatformCommandEnvelope({ commandName: "arrival_data.get_protected", principal: trustedViewer, payload: { contractId } });
    return this.manager.getProtectedArrivalData({ ...envelope, timestamp: this.#clock().toISOString() });
  }
}

export function createBookingContractApplication(options: BookingContractApplicationOptions): BookingContractApplication {
  const { repository, policy, audit, clock = () => new Date() } = options;
  return new BookingContractApplication(new ContractAndArrivalReleaseManager({ repository, policy, audit }), clock);
}
