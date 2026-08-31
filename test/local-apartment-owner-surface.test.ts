import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalApartmentOwnerEnvironment,
  startLocalOwnerServer,
  renderOwnerDashboardHtml,
} from "../apps/local-owner/src/index.js";
import {
  createPlatformCommandEnvelope,
  type CommandPrincipal,
} from "../packages/platform-core/src/index.js";

test("Local Apartment Owner Experience — Full End-to-End Verification", async (t) => {
  const testDir = await mkdtemp(join(tmpdir(), "owner-local-test-"));
  const dbPath = join(testDir, "test_grants.sqlite");
  const clock = () => new Date("2026-08-10T10:00:00Z");

  const env = new LocalApartmentOwnerEnvironment({
    databasePath: dbPath,
    clock,
  });

  await t.test("1. Representative Authority and Operator Identity verification", () => {
    const overview = env.getStateOverview();

    // Verify seeded Operator and Representative
    assert.equal(overview.operator.id, "op-lagos-owner-001");
    assert.equal(overview.operator.name, "Eko Prime Living Ltd");
    assert.equal(overview.operator.status, "approved");
    assert.equal(overview.operator.verified, true);

    // Verify Representative Grant
    assert.equal(overview.representative.actorId, "person-owner-001");
    assert.equal(overview.representative.isAuthorized, true);
    assert.ok(overview.representative.grant);
    assert.equal(overview.representative.grant?.permission, "operator_actions");

    // Negative validation: Unauthorized actor cannot act for operator
    const unauthorizedActor = env.grantStore.canActForOperator({
      actorId: "stranger-999",
      operatorId: "op-lagos-owner-001",
      tenantId: overview.tenantId,
    });
    assert.equal(unauthorizedActor, false);

    // Negative validation: Wrong tenant fails closed
    const wrongTenant = env.grantStore.canActForOperator({
      actorId: "person-owner-001",
      operatorId: "op-lagos-owner-001",
      tenantId: "wrong-tenant",
    });
    assert.equal(wrongTenant, false);
  });

  await t.test("2. Apartment status, physical inspection, and authoritative availability", () => {
    const overview = env.getStateOverview();

    // Verify Unit details
    assert.equal(overview.unit.id, "unit-lagos-ikoyi-001");
    assert.equal(overview.unit.city, "Lagos");
    assert.equal(overview.unit.neighbourhood, "Old Ikoyi");
    assert.equal(overview.unit.occupancyModel, "entire-place");
    assert.equal(overview.unit.capacity, 4);
    assert.equal(overview.unit.published, true);
    assert.equal(overview.unit.inspectionStatus, "passed");
    assert.equal(overview.unit.authorityStatus, "verified");
    assert.equal(overview.unit.nightlyKobo, 12000000); // ₦120,000 / night

    // Verify Availability Calendar check
    assert.equal(overview.availability.isAvailable, true);
  });

  await t.test("3. Trust Tier and Settlement Projections reconcile with ADR 0083", () => {
    const overview = env.getStateOverview();

    // Verify Trust Tier evaluation
    assert.equal(overview.trustTier.tier, "preferred");
    assert.equal(overview.enforcement.enforcementLevel, "coaching");
    assert.equal(overview.enforcement.operatorStatus, "active");

    // Verify Payout Plan breakdown
    // 3 nights @ ₦120,000 = ₦360,000 + ₦10,000 mandatory charges = ₦370,000
    assert.equal(overview.payoutProjections.commissionBaseKobo, 37000000);
    assert.equal(overview.payoutProjections.commissionRate, 0.1); // 10% preferred rate
    assert.equal(overview.payoutProjections.commissionKobo, 3700000); // ₦37,000
    assert.equal(overview.payoutProjections.operatorNetKobo, 33300000); // ₦333,000
    assert.equal(overview.payoutProjections.payableNowKobo, 29970000); // 90% = ₦299,700
    assert.equal(overview.payoutProjections.reserveTrancheKobo, 3330000); // 10% = ₦33,300
    assert.equal(
      overview.payoutProjections.payableNowKobo + overview.payoutProjections.reserveTrancheKobo,
      overview.payoutProjections.operatorNetKobo
    );
  });

  await t.test("4. Incoming Booking Request response workflow (Confirm/Decline & Inventory Lock)", () => {
    // Generate an incoming demo booking request
    const request = env.createDemoIncomingBookingRequest({
      guestId: "guest-test-1",
      guestName: "Chief Emeka Okafor",
      checkIn: "2026-08-15",
      checkOut: "2026-08-18",
    });

    assert.equal(request.facts.status, "disclosed");
    assert.equal(request.facts.delivered, true);
    assert.equal(request.facts.nights, 3);
    assert.equal(request.actions.length, 2); // confirm and decline

    // Confirm booking request on behalf of the Operator
    const confirmed = env.confirmBookingRequest(request.facts.requestId);
    assert.equal(confirmed.facts.status, "confirmed");

    // Re-checking availability for conflicting dates shows occupied/locked
    const conflictAvail = env.calendar.getAuthoritativeAvailability({
      unitId: env.config.unitId,
      checkIn: "2026-08-15",
      checkOut: "2026-08-18",
      clock: env.clock,
    });
    assert.equal(conflictAvail.isAvailable, false);
    assert.equal(conflictAvail.conflictReason, "Overlaps with Payment Pending");

    // Stale action rejection: confirming an already confirmed booking fails closed
    assert.throws(
      () => env.confirmBookingRequest(request.facts.requestId),
      /Cannot confirm booking request/
    );
  });

  await t.test("5. Local Server HTTP endpoints & HTML Dashboard render", async () => {
    // Use fresh env with separate calendar/dates for HTTP test to avoid previous date conflict
    const httpEnv = new LocalApartmentOwnerEnvironment({
      databasePath: join(testDir, "test_grants_http.sqlite"),
      clock,
    });
    const serverInstance = startLocalOwnerServer({ port: 0, environment: httpEnv });
    const actualPort = await serverInstance.listen();

    try {
      // Test GET / (HTML Dashboard)
      const htmlRes = await fetch(`http://localhost:${actualPort}/`);
      assert.equal(htmlRes.status, 200);
      assert.equal(htmlRes.headers.get("content-type"), "text/html; charset=utf-8");
      const htmlText = await htmlRes.text();
      assert.match(htmlText, /Shortlet Apartment Owner Dashboard/);
      assert.match(htmlText, /Eko Prime Living Ltd/);
      assert.match(htmlText, /Luxury 2-Bedroom Apartment in Old Ikoyi/);
      assert.match(htmlText, /₦120,000\.00/);

      // Test GET /api/state (JSON API)
      const jsonRes = await fetch(`http://localhost:${actualPort}/api/state`);
      assert.equal(jsonRes.status, 200);
      const state = (await jsonRes.json()) as any;
      assert.equal(state.operator.id, "op-lagos-owner-001");
      assert.equal(state.unit.id, "unit-lagos-ikoyi-001");
      assert.equal(state.trustTier.tier, "preferred");

      // Test POST /action/demo-request
      const postDemo = await fetch(`http://localhost:${actualPort}/action/demo-request`, {
        method: "POST",
        redirect: "manual",
      });
      assert.equal(postDemo.status, 302);
    } finally {
      await serverInstance.close();
      httpEnv.close();
    }
  });

  env.close();
  await rm(testDir, { recursive: true, force: true });
});

