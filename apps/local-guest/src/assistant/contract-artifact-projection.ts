import type { LocalGuestEnvironment } from "../fixture.js";
import type { BookingContractArtifact } from "../../../web/src/booking-contract-artifact.js";

/**
 * The booking contract artifact as the guest sees it: the contract app's artifact with the unit's
 * current title projected onto it. Every booking surface (restored state, event responses, notice
 * re-presentation) reads through here so the title source is one (issue 18 fix).
 */
export function projectContractArtifact(environment: LocalGuestEnvironment, contractId: string): BookingContractArtifact {
  const artifact = environment.contractApp.getArtifact(contractId, environment.guestPrincipal());
  const unit = environment.unitRepository.findById(artifact.facts.unitId);
  return unit ? { ...artifact, facts: { ...artifact.facts, unitTitle: unit.title } } : artifact;
}
