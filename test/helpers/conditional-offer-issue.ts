import { InMemoryAuditLog, createPlatformCommandEnvelope } from "../../packages/platform-core/src/index.js";
import {
  UnitRepository,
  seedIssue01Units,
  GuestVerificationService,
  GuestIdentityVerificationResultSource,
  RestrictedIdentityStore,
  BookingRequestManager,
  ConditionalOfferManager,
  type ConditionalBookingOffer
} from "../../domains/shortlet/src/index.js";
import { createTestAvailabilityCalendar } from "./availability-calendar.js";

// Shared Conditional Offer fixture (AGENTS.md anti-pattern 4). setup() and createConfirmedRequest() moved verbatim from
// test/issue-and-accept-conditional-booking-offer.test.ts; that file and the state-machine characterisation tests import them.

export function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = createTestAvailabilityCalendar({ repository, audit });
  const identityStore = new RestrictedIdentityStore();
  const verifiedFixtureGuests = new Set(["guest-101", "guest-102", "guest-103", "guest-104"]);
  const verificationResults: GuestIdentityVerificationResultSource = {
    getVerificationResult: ({ tenantId, guestId }) =>
      tenantId === "tenant-lagos" && verifiedFixtureGuests.has(guestId)
        ? { tenantId, guestId, governmentIdVerified: true }
        : null
  };
  const guestVerification = new GuestVerificationService({ repository, verificationResults });
  const requestManager = new BookingRequestManager({
    repository,
    audit,
    calendar,
    guestVerification
  });
  const operatorAuthority = {
    canActForOperator: ({ actorId, operatorId, tenantId }: { actorId: string; operatorId: string; tenantId: string }) =>
      actorId === "rep-operator" && operatorId === "operator-001" && tenantId === "tenant-lagos",
  };
  const offerManager = new ConditionalOfferManager({
    repository,
    audit,
    calendar,
    bookingRequestManager: requestManager,
    operatorAuthority,
  });
  const unit = repository.findAll()[0];

  return { repository, audit, calendar, identityStore, guestVerification, requestManager, offerManager, unit };
}

export function createConfirmedRequest(
  setupObj: ReturnType<typeof setup>,
  clock: () => Date,
  {
    guestId = "guest-101",
    checkIn = "2026-08-01",
    checkOut = "2026-08-05",
    distinctPayer = false
  }: { guestId?: string; checkIn?: string; checkOut?: string; distinctPayer?: boolean } = {}
) {
  const { requestManager, unit } = setupObj;

  const draftEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.create_draft",
    principal: { id: guestId, role: "guest", tenantId: "tenant-lagos" },
    payload: {
      unitId: unit.id,
      primaryGuest: { id: guestId, name: "Tunde Ednut", isGovernmentIdVerified: true },
      selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
      occupants: [{ name: "Tunde Ednut" }],
      ...(distinctPayer
        ? {
            distinctPayer: {
              id: "payer-B",
              name: "Distinct Payer",
              passportNumber: "secret",
              ninNumber: "secret",
              rawEvidence: "secret",
              fullAddress: "secret",
              riskScore: 99
            },
            distinctPayerAttestation: { accepted: true, version: "distinct-payer-v1" }
          }
        : {}),
      checkIn,
      checkOut
    } as any
  });
  const draft = requestManager.createDraft(draftEnv, { clock });

  const discloseEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: guestId, role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft.draftId }
  });
  const request = requestManager.discloseBookingRequest(discloseEnv, { clock });

  const confirmEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.confirm",
    principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request.requestId }
  });
  const confirmedRequest = requestManager.confirmBookingRequest(confirmEnv, { clock });

  return { draft, disclosedRequest: request, request: confirmedRequest };
}


export function issueConditionalOffer(
  s: ReturnType<typeof setup>,
  request: { readonly requestId: string },
  clock: () => Date
): ConditionalBookingOffer {
  return s.offerManager.issueOffer(
    createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal: { id: "rep-operator", role: "operator", tenantId: "tenant-lagos" },
      payload: { requestId: request.requestId }
    }),
    { clock }
  );
}

export function acceptEnvelopeFor(offer: ConditionalBookingOffer, guestId = "guest-101") {
  return createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: guestId, role: "guest", tenantId: "tenant-lagos" },
    payload: { offerId: offer.offerId, confirmationToken: offer.confirmationToken }
  });
}
