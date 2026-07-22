import test from "node:test";
import assert from "node:assert/strict";
import {
  RestrictedIdentityStore,
  GuestVerificationService,
  UnitRepository,
  seedIssue01Units
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const identityStore = new RestrictedIdentityStore();
  const service = new GuestVerificationService({ repository, identityStore });
  const unit = repository.findAll()[0]; // capacity 4
  return { repository, identityStore, service, unit };
}

test("Unverified Primary Guests and prohibited third-party bookings cannot progress to disclosure", () => {
  const { service, unit } = setup();

  // Primary Guest is unverified -> throws error
  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: false },
      isPrimaryGuestOccupant: true,
      occupants: [{ name: "Chidi Okafor" }]
    }),
    /Unverified Primary Guest/i
  );

  // Prohibited third-party booking (isPrimaryGuestOccupant = false without valid distinct payer) -> throws error
  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: false,
      occupants: [{ name: "Someone Else" }]
    }),
    /Prohibited third-party booking/i
  );
});

test("Occupancy and named-occupant rules are checked against Unit capacity and policy", () => {
  const { service, unit } = setup(); // capacity 4

  // Exceeds unit capacity (5 occupants for capacity 4) -> throws error
  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: true,
      occupants: [
        { name: "Chidi Okafor" },
        { name: "Amina Bello" },
        { name: "Emeka Obi" },
        { name: "Funke Adebayo" },
        { name: "Tunde Bakare" } // 5th occupant
      ]
    }),
    /Occupancy exceeds Unit capacity/i
  );

  // Unnamed occupant (blank name) -> throws error
  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: true,
      occupants: [{ name: "Chidi Okafor" }, { name: "" }]
    }),
    /All overnight occupants must be named/i
  );
});

test("A permitted distinct payer requires the accepted attestations and cannot replace the Primary Guest", () => {
  const { service, unit } = setup();

  // Distinct payer provided but missing attestation -> throws error
  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: true,
      occupants: [{ name: "Chidi Okafor" }],
      distinctPayer: { id: "payer-1", name: "Corporate Sponsor LLC" },
      payerAttestationAccepted: false
    }),
    /Payer attestation required/i
  );

  // Distinct payer trying to replace Primary Guest (Primary Guest not staying in occupants list) -> throws error
  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: false, // Trying to swap out Primary Guest
      occupants: [{ name: "Other Guest" }],
      distinctPayer: { id: "payer-1", name: "Corporate Sponsor LLC" },
      payerAttestationAccepted: true
    }),
    /Distinct payer cannot replace Primary Guest/i
  );

  // Valid distinct payer WITH Primary Guest staying and accepted attestation -> succeeds
  const result = service.validateDisclosure({
    unitId: unit.id,
    primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Chidi Okafor" }],
    distinctPayer: { id: "payer-1", name: "Corporate Sponsor LLC" },
    payerAttestationAccepted: true
  });
  assert.equal(result.approvedForDisclosure, true);
  assert.equal(result.distinctPayerAttached, true);
});

test("Restricted identity data is minimized, tenant-scoped, redacted, and never exposed through ordinary AG-UI/A2UI state", () => {
  const { service, identityStore, unit } = setup();

  // Store raw restricted identity evidence in tenant scope
  identityStore.storeIdentityEvidence({
    tenantId: "tenant-lagos",
    guestId: "guest-1",
    rawEvidence: {
      ninNumber: "12345678901",
      passportNumber: "A00112233",
      documentScanUrl: "https://secure-vault.internal/docs/scan123.pdf",
      fullAddress: "15 Victoria Island Way, Lagos"
    }
  });

  // Verify disclosure validation output produces a sanitized/redacted projection for AG-UI/A2UI state
  const result = service.validateDisclosure({
    tenantId: "tenant-lagos",
    unitId: unit.id,
    primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Chidi Okafor" }]
  });

  assert.equal(result.approvedForDisclosure, true);

  // Redacted projection check
  const projection = service.getInteractionProjection(result.disclosureId);
  assert.equal(projection.primaryGuestName, "Chidi Okafor");
  assert.equal(projection.isVerified, true);
  // Ensure NO restricted identity fields are exposed in interaction projection
  assert.equal(projection.ninNumber, undefined);
  assert.equal(projection.passportNumber, undefined);
  assert.equal(projection.documentScanUrl, undefined);
  assert.equal(projection.fullAddress, undefined);

  // Unauthenticated or wrong tenant scope retrieval must be rejected
  assert.throws(
    () => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", null),
    /Access denied/i
  );
  assert.throws(
    () => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { tenantId: "tenant-other" }),
    /Access denied/i
  );

  // Valid tenant context succeeds
  const raw = identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { tenantId: "tenant-lagos" });
  assert.equal(raw.ninNumber, "12345678901");
});

