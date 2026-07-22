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
  const unit = repository.findAll()[0];
  return { repository, identityStore, service, unit };
}

test("Unverified Primary Guests and prohibited third-party bookings cannot progress to disclosure", () => {
  const { service, unit } = setup();

  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: false },
      isPrimaryGuestOccupant: true,
      occupants: [{ name: "Chidi Okafor" }]
    }),
    /Unverified Primary Guest/i
  );

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
  const { service, unit } = setup();

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
        { name: "Tunde Bakare" }
      ]
    }),
    /Occupancy exceeds Unit capacity/i
  );

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

  assert.throws(
    () => service.validateDisclosure({
      unitId: unit.id,
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: false,
      occupants: [{ name: "Other Guest" }],
      distinctPayer: { id: "payer-1", name: "Corporate Sponsor LLC" },
      payerAttestationAccepted: true
    }),
    /Distinct payer cannot replace Primary Guest/i
  );

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

  const result = service.validateDisclosure({
    tenantId: "tenant-lagos",
    unitId: unit.id,
    primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Chidi Okafor" }]
  });

  assert.equal(result.approvedForDisclosure, true);

  const projection: any = service.getInteractionProjection(result.disclosureId);
  assert.equal(projection.primaryGuestName, "Chidi Okafor");
  assert.equal(projection.isVerified, true);
  assert.equal(projection.ninNumber, undefined);
  assert.equal(projection.passportNumber, undefined);
  assert.equal(projection.documentScanUrl, undefined);
  assert.equal(projection.fullAddress, undefined);

  assert.throws(
    () => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", null),
    /Access denied/i
  );
  assert.throws(
    () => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { tenantId: "tenant-other" }),
    /Access denied/i
  );

  const raw: any = identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { tenantId: "tenant-lagos" });
  assert.equal(raw.ninNumber, "12345678901");
});
