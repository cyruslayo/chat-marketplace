import assert from "node:assert/strict";
import test from "node:test";
import type { WebServerEventHandoff } from "@weaver/web";
import {
  AvailabilityCalendar,
  GuestVerificationService,
  UnitRepository,
  BookingRequestManager,
  seedIssue01Units,
} from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  createBookingRequestApplication,
  createBookingRequestServerEventHandler,
  getConventionalBookingRequestView,
  resolveBookingRequestServerEvent,
} from "../apps/web/src/index.js";
import { createBookingRequestWebAgentAdapter } from "../apps/web-agent/src/index.js";
import { bookingRequestArtifactToA2UI } from "../apps/web-agent/src/index.js";

const NOW = new Date("2026-07-22T10:00:00Z");
const clock = () => NOW;

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const application = createBookingRequestApplication({
    repository,
    audit,
    calendar,
    guestVerification: new GuestVerificationService({ repository, verificationResults: {
      getVerificationResult: ({ tenantId, guestId }) => ({ tenantId, guestId, governmentIdVerified: true }),
    } }),
    clock,
  });
  const unit = repository.findAll()[0];
  assert.ok(unit);
  return { application, audit, unit };
}

function disclose(application: ReturnType<typeof setup>["application"], guestId: string, unitId: string, autoDeliver = true) {
  const guest = { id: guestId, role: "guest" as const, tenantId: "tenant-lagos" };
  const draft = application.createDraft({
    unitId,
    primaryGuest: { id: guestId, name: "Safe Guest" },
    occupants: [{ name: "Safe Guest" }],
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
  }, guest);
  return { guest, request: application.disclose(draft.draftId, guest, autoDeliver) };
}

function actionEvent(artifact: ReturnType<ReturnType<typeof setup>["application"]["getArtifact"]>, name: string): WebServerEventHandoff {
  const action = artifact.actions.find((candidate) => candidate.type === (name.endsWith("confirm") ? "confirm" : "decline"));
  assert.ok(action);
  return { message: { version: "v0.9.1", action: { name, surfaceId: "booking-surface", sourceComponentId: "booking-request-confirm-button", timestamp: NOW.toISOString(), context: {
    artifactId: action.artifactId,
    requestId: action.requestId,
    expectedStatus: action.expectedStatus,
    projectionVersion: action.projectionVersion,
  } } } } as unknown as WebServerEventHandoff;
}

test("production application creates guest commands and minimizes the canonical artifact", () => {
  const { application, audit, unit } = setup();
  const { request } = disclose(application, "guest-98", unit.id);
  const entries = audit.entries().filter((entry) => entry.requestId === request.requestId || entry.draftId === request.draftId);
  assert.ok(entries.some((entry) => entry.type === "booking_request.draft_created" && typeof entry.commandEnvelopeId === "string"));
  assert.ok(entries.some((entry) => entry.type === "booking_request.disclosed" && typeof entry.commandEnvelopeId === "string"));

  const artifact = application.getArtifact(request.requestId, { id: "guest-98", role: "guest", tenantId: "tenant-lagos" });
  assert.equal(artifact.id, `booking-request:${request.requestId}`);
  assert.equal(artifact.kind, "shortlet.booking-request");
  assert.equal(artifact.schemaVersion, "shortlet.booking-request/v1");
  assert.deepEqual(artifact.domainReferences.map((reference) => reference.type), ["booking-request", "unit"]);
  assert.equal(artifact.facts.deliveryDeadlineAt, request.deliveryDeadlineAt);
  assert.equal(artifact.actions.length, 0);
  assert.doesNotMatch(JSON.stringify(artifact), /ninNumber|passportNumber|rawEvidence|providerPayload|riskScore|paymentSecret|sessionId|deviceId/);

  const spoofed = application.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "different-guest", name: "Different Guest" },
    occupants: [{ name: "Different Guest" }],
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    checkIn: "2026-08-05",
    checkOut: "2026-08-07",
  }, { id: "trusted-guest", role: "guest", tenantId: "tenant-lagos" });
  assert.throws(() => application.disclose(spoofed.draftId, { id: "trusted-guest", role: "guest", tenantId: "tenant-lagos" }, true), /Primary Guest/);
});

test("Weaver and conventional paths share the artifact and trusted action boundary", () => {
  const { application, unit } = setup();
  const { request } = disclose(application, "guest-99", unit.id);
  const operator = { id: unit.operator.id, role: "operator" as const, tenantId: "tenant-lagos" };
  const conventional = getConventionalBookingRequestView(application, request.requestId, operator);
  const agent = createBookingRequestWebAgentAdapter({ application, principal: operator, createSurfaceId: (id) => `surface:${id}` }).get(request.requestId);
  assert.deepEqual(agent.artifact, conventional.artifact);
  assert.deepEqual(bookingRequestArtifactToA2UI({ artifact: agent.artifact, surfaceId: agent.surfaceId }), bookingRequestArtifactToA2UI({ artifact: agent.artifact, surfaceId: agent.surfaceId }));
  assert.deepEqual(agent.a2uiMessages.map((message) => message.version), ["v0.9.1", "v0.9.1"]);

  const updated: string[] = [];
  const rejected: string[] = [];
  const handler = createBookingRequestServerEventHandler({
    application,
    getArtifact: (requestId, principal) => application.getArtifact(requestId, principal),
    getPrincipal: () => operator,
    onUpdated: (artifact) => updated.push(artifact.facts.status),
    onRejected: (rejection) => rejected.push(rejection.code),
  });
  const event = actionEvent(conventional.artifact, "shortlet.booking-request.confirm");
  handler(event);
  assert.deepEqual(updated, ["confirmed"]);
  handler(event);
  assert.deepEqual(rejected, ["STALE_ACTION"]);
});

test("Operator action routing is server-authorized and stale actions fail closed", () => {
  const { application, unit } = setup();
  const { request } = disclose(application, "guest-100", unit.id);
  const artifact = application.getArtifact(request.requestId, { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" });
  assert.equal(artifact.actions.length, 2);
  const wrongTenant = { id: unit.operator.id, role: "operator" as const, tenantId: "other-tenant" };
  assert.equal(application.getArtifact(request.requestId, wrongTenant).actions.length, 0);
  assert.throws(() => application.confirm({ ...artifact.actions[0], action: "confirm", principal: wrongTenant }), /not authorized/);
  assert.throws(() => application.confirm({ ...artifact.actions[0], action: "confirm", principal: { id: "guest-100", role: "guest", tenantId: "tenant-lagos" } }), /not authorized/);
});

test("Delivery changes Booking Request action authority and rejects its old projection", () => {
  const { application, unit } = setup();
  const { request } = disclose(application, "guest-pending", unit.id, false);
  const operator = { id: unit.operator.id, role: "operator" as const, tenantId: "tenant-lagos" };
  const undelivered = application.getArtifact(request.requestId, operator);
  assert.equal(undelivered.facts.delivered, false);
  assert.deepEqual(undelivered.actions, []);

  application.manager.markDelivered(createPlatformCommandEnvelope({
    commandName: "booking_request.mark_delivered",
    principal: { id: "system", role: "system" },
    payload: { requestId: request.requestId },
  }), { clock });

  const delivered = application.getArtifact(request.requestId, operator);
  assert.equal(delivered.facts.delivered, true);
  assert.notEqual(undelivered.projectionVersion, delivered.projectionVersion);
  assert.deepEqual(delivered.actions.map((action) => action.type), ["confirm", "decline"]);

  const staleEvent: WebServerEventHandoff = {
    message: {
      version: "v0.9.1",
      action: {
        name: "shortlet.booking-request.confirm",
        surfaceId: "booking-surface",
        sourceComponentId: "booking-request-confirm-button",
        timestamp: NOW.toISOString(),
        context: {
          artifactId: undelivered.id,
          requestId: request.requestId,
          expectedStatus: "disclosed",
          projectionVersion: undelivered.projectionVersion,
        },
      },
    },
  } as unknown as WebServerEventHandoff;
  const result = resolveBookingRequestServerEvent({ event: staleEvent, artifact: delivered, application, principal: operator });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "STALE_ACTION");
});
