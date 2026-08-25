import test from "node:test";
import assert from "node:assert/strict";
import {
  DISTINCT_PAYER_ATTESTATION_VERSION,
  DistinctPayerAttestation,
  RestrictedIdentityStore,
  SELF_BOOKING_ATTESTATION_VERSION,
  SelfBookingAttestation,
  GuestVerificationService,
  GuestIdentityVerificationResultSource,
  UnitRepository,
  seedIssue01Units
} from "../domains/shortlet/src/index.js";
import type { SecurityContext } from "../packages/platform-core/src/index.js";

const selfBookingAttestation: SelfBookingAttestation = {
  accepted: true,
  version: SELF_BOOKING_ATTESTATION_VERSION
};
const payerAttestation: DistinctPayerAttestation = {
  accepted: true,
  version: DISTINCT_PAYER_ATTESTATION_VERSION
};

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const identityStore = new RestrictedIdentityStore({
    authorizer: (context, request) => context.principalId === request.guestId
  });
  const verificationResults: GuestIdentityVerificationResultSource = {
    getVerificationResult: ({ tenantId, guestId }) => ({ tenantId, guestId, governmentIdVerified: true })
  };
  const service = new GuestVerificationService({ repository, verificationResults });
  const unit = repository.findAll()[0];
  return { repository, identityStore, service, unit };
}

function validInput(unitId: string) {
  return {
    tenantId: "tenant-lagos",
    unitId,
    primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true },
    occupants: [{ name: "Chidi Okafor" }],
    selfBookingAttestation,
    attestingPrincipalId: "guest-1"
  };
}

test("Unverified Primary Guests and prohibited third-party bookings cannot progress to disclosure", () => {
  const { service, repository, unit } = setup();
  const noSourceService = new GuestVerificationService({ repository });
  assert.throws(
    () => noSourceService.validateDisclosure({
      ...validInput(unit.id),
      primaryGuest: { id: "guest-1", name: "Chidi Okafor", isGovernmentIdVerified: true }
    }),
    /Unverified Primary Guest/i
  );
  assert.throws(
    () => service.validateDisclosure({
      ...validInput(unit.id),
      occupants: [{ name: "Someone Else" }]
    }),
    /Primary Guest must be included/i
  );
});

test("Occupancy and named-occupant rules are checked against Unit capacity and policy", () => {
  const { service, unit } = setup();
  assert.throws(
    () => service.validateDisclosure({
      ...validInput(unit.id),
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
    () => service.validateDisclosure({ ...validInput(unit.id), occupants: [{ name: "   " }] }),
    /All overnight occupants must be named/i
  );
  assert.throws(
    () => service.validateDisclosure({ ...validInput(unit.id), occupants: [] }),
    /At least one overnight occupant/i
  );
});

test("A permitted distinct payer requires the accepted attestations and cannot replace the Primary Guest", () => {
  const { service, unit } = setup();
  assert.throws(
    () => service.validateDisclosure({
      ...validInput(unit.id),
      distinctPayer: { id: "payer-1", name: "Sponsor" }
    }),
    /Distinct payer attestation/i
  );
  assert.throws(
    () => service.validateDisclosure({
      ...validInput(unit.id),
      distinctPayer: { id: "payer-1", name: "Sponsor" },
      distinctPayerAttestation: { accepted: true, version: "unsupported" }
    }),
    /Distinct payer attestation/i
  );
  const result = service.validateDisclosure({
    ...validInput(unit.id),
    distinctPayer: { id: "payer-1", name: "Sponsor" },
    distinctPayerAttestation: payerAttestation
  });
  assert.equal(result.approvedForDisclosure, true);
  assert.equal(result.distinctPayerAttached, true);
});

test("Restricted identity data is minimized, tenant-scoped, redacted, and never exposed through ordinary interaction/A2UI state", () => {
  const { service, identityStore, unit } = setup();
  const completeContext: SecurityContext = {
    principalId: "guest-1",
    tenantId: "tenant-lagos",
    sessionId: "session-1"
  };
  identityStore.storeIdentityEvidence({
    tenantId: "tenant-lagos",
    guestId: "guest-1",
    rawEvidence: {
      ninNumber: "12345678901",
      passportNumber: "A00112233",
      documentScanUrl: "https://secure-vault.internal/docs/scan123.pdf",
      fullAddress: "15 Victoria Island Way, Lagos"
    }
  }, completeContext);
  const result = service.validateDisclosure({
    ...validInput(unit.id),
    primaryGuest: {
      id: "guest-1",
      name: "Chidi Okafor",
      isGovernmentIdVerified: true,
      ninNumber: "must-not-propagate"
    } as { id: string; name: string; isGovernmentIdVerified: boolean }
  });
  const projection = service.getInteractionProjection(result.disclosureId) as Record<string, unknown>;
  assert.equal(projection.primaryGuestName, "Chidi Okafor");
  assert.equal(projection.ninNumber, undefined);
  assert.equal(projection.documentScanUrl, undefined);

  assert.throws(() => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1"), /SecurityContext/i);
  assert.throws(() => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { tenantId: "tenant-lagos" } as SecurityContext), /SecurityContext/i);
  assert.throws(() => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { ...completeContext, tenantId: "tenant-other" }), /Access denied/i);
  assert.throws(() => identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", { ...completeContext, principalId: "other" }), /Access denied/i);
  const raw = identityStore.getRawIdentityEvidence("tenant-lagos", "guest-1", completeContext);
  assert.equal(raw?.ninNumber, "12345678901");
});

test("Restricted identity writes require complete, tenant-bound, operation-specific authorization", () => {
  const evidence = { ninNumber: "12345678901" };
  const context: SecurityContext = {
    principalId: "staff-1",
    tenantId: "tenant-lagos",
    sessionId: "session-1"
  };
  const allowWrite = (_context: SecurityContext, request: { operation: "read" | "write"; tenantId: string; guestId: string }) =>
    request.operation === "write" && request.tenantId === "tenant-lagos" && request.guestId === "guest-1";
  const makeStore = (authorizer?: (context: SecurityContext, request: { operation: "read" | "write"; tenantId: string; guestId: string }) => boolean) =>
    new RestrictedIdentityStore({ authorizer });

  assert.throws(() => makeStore(allowWrite).storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, null as any), /Access denied/i);
  assert.throws(() => makeStore(allowWrite).storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, { tenantId: "tenant-lagos", sessionId: "session-1" } as SecurityContext), /Access denied/i);
  assert.throws(() => makeStore(() => true).storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, { ...context, tenantId: "tenant-other" }), /Access denied/i);
  assert.throws(() => makeStore().storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, context), /Access denied/i);
  assert.throws(() => makeStore(() => false).storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, context), /Access denied/i);
  assert.throws(() => makeStore((_, request) => request.guestId === "guest-1").storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-2", rawEvidence: evidence }, context), /Access denied/i);
  assert.throws(() => makeStore((_, request) => request.operation === "write" && (request as Record<string, unknown>).isAdmin === true).storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, { ...context, role: "admin", isAdmin: true, isAuthorized: true } as SecurityContext), /Access denied/i);

  const writeOnlyStore = makeStore((_, request) => request.operation === "write" && request.guestId === "guest-1");
  writeOnlyStore.storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, context);
  assert.throws(() => writeOnlyStore.getRawIdentityEvidence("tenant-lagos", "guest-1", context), /Access denied/i);

  const readAndWriteStore = makeStore((_, request) => request.tenantId === "tenant-lagos" && request.guestId === "guest-1");
  readAndWriteStore.storeIdentityEvidence({ tenantId: "tenant-lagos", guestId: "guest-1", rawEvidence: evidence }, context);
  assert.deepEqual(readAndWriteStore.getRawIdentityEvidence("tenant-lagos", "guest-1", context), evidence);
});

test("Authoritative verification results are tenant-and-guest bound and caller booleans cannot authorize disclosure", () => {
  const { repository, unit } = setup();
  const input = validInput(unit.id);
  const resultFor = (result: { tenantId: string; guestId: string; governmentIdVerified: boolean } | null) =>
    new GuestVerificationService({
      repository,
      verificationResults: { getVerificationResult: () => result }
    });

  for (const [result, message] of [
    [null, "null result"],
    [{ tenantId: "tenant-other", guestId: "guest-1", governmentIdVerified: true }, "wrong tenant"],
    [{ tenantId: "tenant-lagos", guestId: "guest-other", governmentIdVerified: true }, "wrong guest"],
    [{ tenantId: "tenant-lagos", guestId: "guest-1", governmentIdVerified: false }, "unverified"]
  ] as const) {
    assert.throws(
      () => resultFor(result).validateDisclosure(input),
      /Unverified Primary Guest/i,
      message
    );
  }

  const approved = resultFor({ tenantId: "tenant-lagos", guestId: "guest-1", governmentIdVerified: true })
    .validateDisclosure(input);
  assert.equal(approved.approvedForDisclosure, true);
});

test("Self-Booking and distinct-payer attestations require the authenticated Primary Guest actor", () => {
  const { service, unit } = setup();
  assert.throws(
    () => service.validateDisclosure({ ...validInput(unit.id), attestingPrincipalId: "guest-other" }),
    /Primary Guest/i
  );
  assert.throws(
    () => service.validateDisclosure({
      ...validInput(unit.id),
      attestingPrincipalId: "guest-other",
      distinctPayer: { id: "payer-1", name: "Sponsor" },
      distinctPayerAttestation: payerAttestation
    }),
    /Primary Guest/i
  );
  const result = service.validateDisclosure({
    ...validInput(unit.id),
    distinctPayer: { id: "payer-1", name: "Sponsor" },
    distinctPayerAttestation: payerAttestation
  });
  assert.equal(result.selfBookingAttestationVersion, SELF_BOOKING_ATTESTATION_VERSION);
  assert.equal(result.distinctPayerAttestationVersion, DISTINCT_PAYER_ATTESTATION_VERSION);
});

test("Unsupported or missing Self-Booking attestation cannot disclose", () => {
  const { service, unit } = setup();
  assert.throws(() => service.validateDisclosure({ ...validInput(unit.id), selfBookingAttestation: undefined as never }), /Self-Booking attestation/i);
  assert.throws(() => service.validateDisclosure({ ...validInput(unit.id), selfBookingAttestation: { accepted: true, version: "unsupported" } }), /Self-Booking attestation/i);
});
