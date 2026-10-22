import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { createDemoRequestAcceptor, DEMO_OPERATOR_ACTOR_ID } from "../apps/local-owner/src/demo-operator-acceptance.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteAuditLog } from "../packages/platform-core/src/sqlite-audit-log.js";
import { demoDatabase, firstAction, removeDemoDatabase } from "./helpers/demo-mode-fixture.js";

const START = "2026-09-03T10:00:00Z";
/** Test-only demo delay, in seconds; the production default is zero (ADR 0105). */
const TEST_DELAY_SECONDS = 60;

function draft(environment: LocalGuestEnvironment) {
  return environment.bookingRequestApp.createDraft(
    {
      unitId: "unit-lagos-ikoyi-001",
      primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
      occupants: environment.demoOccupants(2),
      selfBookingAttestation: environment.selfBookingAttestation(),
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
    },
    environment.guestPrincipal(),
  );
}

/** A guest and an owner on one database, the way the staging Durable Object composes them (ADR 0105). */
function withSharedDatabase(demo: boolean, delaySeconds: number, clock: () => Date, run: (guest: LocalGuestEnvironment, owner: LocalApartmentOwnerEnvironment) => void): void {
  const f = demoDatabase();
  const owner = LocalApartmentOwnerEnvironment.openNode({ databasePath: f.path, clock });
  const guest = LocalGuestEnvironment.openNode({
    databasePath: f.path,
    clock,
    demo,
    ...(demo ? { demoRequestAcceptor: createDemoRequestAcceptor(owner, delaySeconds) } : {}),
  });
  try {
    run(guest, owner);
  } finally {
    guest.close();
    owner.close();
    removeDemoDatabase(f.dir);
  }
}

test("AC4: with demo on, a submitted request is accepted through the operator-accept command and the guest reaches the offer", () => {
  withSharedDatabase(true, 0, () => new Date(START), (guest) => {
    const requestId = guest.bookingRequestApp.disclose(draft(guest).draftId, guest.guestPrincipal()).requestId;
    const { offerId } = guest.acceptDisclosedRequest(requestId);
    assert.ok(offerId.length > 0);
    assert.equal(guest.bookingRequestApp.getArtifact(requestId, guest.guestPrincipal()).facts.status, "confirmed");
    assert.equal(guest.interactionStore.findConditionalOfferByRequestId(requestId)?.offerId, offerId);
  });
});

test("AC4 through the real guest request path: a submitted Request to Book reaches the Conditional Booking Offer", async () => {
  const f = demoDatabase();
  const clock = () => new Date(START);
  const owner = LocalApartmentOwnerEnvironment.openNode({ databasePath: f.path, clock });
  const environment = LocalGuestEnvironment.openNode({ databasePath: f.path, clock, demo: true, demoRequestAcceptor: createDemoRequestAcceptor(owner, 0) });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-abcdef0d02";
    let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Inspection, Request Draft and review, each through the same event path a browser uses.
    for (let step = 0; step < 3; step++) {
      const next = app.handleEvent(threadId, firstAction(result.surfaces[0]!));
      assert.equal(next.ok, true);
      if (!next.ok) return;
      result = next;
    }
    const submitted = app.handleEvent(threadId, firstAction(result.surfaces[0]!));
    assert.equal(submitted.ok, true);
    if (!submitted.ok) return;
    assert.match(submitted.surfaces.map((surface) => surface.surfaceId).join(" "), /:offer:/, "the guest reaches the offer surface");
    const [requestId] = environment.interactionStore.listBookingRequestIds();
    assert.ok(requestId);
    assert.equal(environment.bookingRequestApp.getArtifact(requestId, environment.guestPrincipal()).facts.status, "confirmed");
    assert.ok(environment.interactionStore.findConditionalOfferByRequestId(requestId));
  } finally {
    environment.close();
    owner.close();
    removeDemoDatabase(f.dir);
  }
});

test("AC4: an audit row records the demo operator as the actor of the acceptance", () => {
  const f = demoDatabase();
  const owner = LocalApartmentOwnerEnvironment.openNode({ databasePath: f.path });
  const guest = LocalGuestEnvironment.openNode({ databasePath: f.path, demo: true, demoRequestAcceptor: createDemoRequestAcceptor(owner, 0) });
  try {
    const requestId = guest.bookingRequestApp.disclose(draft(guest).draftId, guest.guestPrincipal()).requestId;
    guest.acceptDisclosedRequest(requestId);
    const database = new NodeSqliteDatabase(f.path);
    try {
      const entries = new SqliteAuditLog(database).entries();
      assert.ok(entries.some((entry) => entry.actorId === DEMO_OPERATOR_ACTOR_ID && entry.type === "operator_confirmation_attempted"), "the demo operator confirmation is audited");
      assert.equal(entries.some((entry) => entry.actorId === DEMO_OPERATOR_ACTOR_ID && /hold|secret|token/i.test(JSON.stringify(entry))), false, "the audit row holds no credential");
    } finally {
      database.close();
    }
  } finally {
    guest.close();
    owner.close();
    removeDemoDatabase(f.dir);
  }
});

test("AC4 failure path: with demo off, no request is auto-accepted", () => {
  withSharedDatabase(false, 0, () => new Date(START), (guest) => {
    const requestId = guest.bookingRequestApp.disclose(draft(guest).draftId, guest.guestPrincipal()).requestId;
    assert.throws(() => guest.acceptDisclosedRequest(requestId), /demo acceptance is not configured/i);
    assert.equal(guest.bookingRequestApp.getArtifact(requestId, guest.guestPrincipal()).facts.status, "disclosed");
    assert.equal(guest.interactionStore.findConditionalOfferByRequestId(requestId) ?? null, null);
    assert.equal(guest.acceptDueDemoRequest(requestId), false, "the due-check never accepts without the demo");
  });
});

test("AC4: a configured demo delay holds acceptance until it has elapsed on the injected clock", () => {
  let now = Date.parse(START);
  withSharedDatabase(true, TEST_DELAY_SECONDS, () => new Date(now), (guest) => {
    const requestId = guest.bookingRequestApp.disclose(draft(guest).draftId, guest.guestPrincipal()).requestId;
    assert.equal(guest.acceptDueDemoRequest(requestId), false, "not yet due at disclosure");
    now += (TEST_DELAY_SECONDS - 1) * 1000;
    assert.equal(guest.acceptDueDemoRequest(requestId), false, "one second early is still not due");
    assert.equal(guest.bookingRequestApp.getArtifact(requestId, guest.guestPrincipal()).facts.status, "disclosed");
    now += 1000;
    assert.equal(guest.acceptDueDemoRequest(requestId), true, "accepted once the delay has elapsed");
    assert.equal(guest.bookingRequestApp.getArtifact(requestId, guest.guestPrincipal()).facts.status, "confirmed");
  });
});

test("AC4 failure path: a delayed request is not accepted by the submit path", async () => {
  const f = demoDatabase();
  let now = Date.parse(START);
  const clock = () => new Date(now);
  const owner = LocalApartmentOwnerEnvironment.openNode({ databasePath: f.path, clock });
  const environment = LocalGuestEnvironment.openNode({ databasePath: f.path, clock, demo: true, demoRequestAcceptor: createDemoRequestAcceptor(owner, TEST_DELAY_SECONDS) });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-abcdef0d03";
    let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (let step = 0; step < 3; step++) {
      const next = app.handleEvent(threadId, firstAction(result.surfaces[0]!));
      assert.equal(next.ok, true);
      if (!next.ok) return;
      result = next;
    }
    const submitted = app.handleEvent(threadId, firstAction(result.surfaces[0]!));
    assert.equal(submitted.ok, true);
    const [requestId] = environment.interactionStore.listBookingRequestIds();
    assert.ok(requestId);
    assert.equal(environment.bookingRequestApp.getArtifact(requestId, environment.guestPrincipal()).facts.status, "disclosed");
    assert.equal(environment.interactionStore.findConditionalOfferByRequestId(requestId) ?? null, null);
    now += TEST_DELAY_SECONDS * 1000;
    assert.equal(environment.acceptDueDemoRequest(requestId), true);
  } finally {
    environment.close();
    owner.close();
    removeDemoDatabase(f.dir);
  }
});
