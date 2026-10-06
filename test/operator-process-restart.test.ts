import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import type { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/index.js";
import { operatorRestartFixture } from "./helpers/operator-restart.js";
import { operatorGet } from "./helpers/operator-session.js";
import { reservation } from "./helpers/back-office-reservation.js";
import { revenuePrincipal, setupRevenueRelease } from "./revenue-release-fixtures.js";

const human = (env: LocalApartmentOwnerEnvironment, role: "admin" | "authorized_staff" = "authorized_staff") =>
  ({ id: env.config.adminId, role, tenantId: env.config.tenantId });

/** An operator-wide pause: protective action, then a final human decision (ADR 0064). */
function pauseOperator(env: LocalApartmentOwnerEnvironment): string {
  const scope = { operatorId: env.config.operatorId, unitId: env.config.unitId };
  const action = env.enforcementManager.applyImmediateProtectiveAction(createPlatformCommandEnvelope({
    commandName: "operator_enforcement.protective_action", principal: human(env), payload: { ...scope, reason: "turnover risk" },
  }));
  env.enforcementManager.finalizeEnforcementDecision(createPlatformCommandEnvelope({
    commandName: "operator_enforcement.finalize", principal: human(env), payload: { ...scope, enforcementId: action.enforcementId, decision: "operator_pause" },
  }));
  return action.enforcementId;
}

test("06d AC1: Enforcement state applied before a restart is still in force after it", async () => {
  const f = await operatorRestartFixture();
  try {
    const env = () => f.server.environment;
    const scope = { operatorId: env().config.operatorId, unitId: env().config.unitId };
    const tier = () => env().reservePayoutManager.evaluateOperatorTrustTier({ operatorId: scope.operatorId, tenantId: env().config.tenantId });
    const enforcementId = pauseOperator(env());
    const before = { projections: env().enforcementManager.getProjections(scope), tier: tier() };
    assert.equal(before.projections.operatorStatus, "paused");
    assert.equal(before.tier.overriddenByEnforcement, true);

    await f.restart();

    assert.deepEqual(env().enforcementManager.getProjections(scope), before.projections);
    assert.equal(env().enforcementManager.getProjections(scope).operatorStatus, "paused", "a paused operator is still refused after the restart");
    assert.deepEqual(tier(), before.tier);
    // The numbering carries on: a restart can never hand out an enforcement id a decision already holds.
    const next = env().enforcementManager.applyImmediateProtectiveAction(createPlatformCommandEnvelope({
      commandName: "operator_enforcement.protective_action", principal: human(env()), payload: { ...scope, reason: "second" },
    }));
    assert.notEqual(next.enforcementId, enforcementId);
  } finally { await f.close(); }
});

test("06d AC2: Owner-side booking state survives a restart", async () => {
  const f = await operatorRestartFixture();
  try {
    const id = await reservation(f, "2026-09-10", "2026-09-13");
    const env = () => f.server.environment;
    const principal = () => env().getRepresentativePrincipal();
    const before = env().operatorReservation(id, principal());
    const stored = env().bookingStateRepository.findReservationById(before.reservationId);
    assert.ok(stored, "the owner reads the same booking tables the Guest side wrote");

    await f.restart();

    assert.deepEqual(env().bookingStateRepository.findReservationById(before.reservationId), stored);
    assert.ok(env().bookingStateRepository.findContractById(stored.contractId));
    assert.deepEqual(env().operatorReservation(id, principal()), before);
  } finally { await f.close(); }
});

test("06d AC4: The operator restart test passes end to end: session, grant, request action, revenue, enforcement and audit", async () => {
  const f = await operatorRestartFixture();
  try {
    const env = () => f.server.environment;
    const scope = { operatorId: env().config.operatorId, unitId: env().config.unitId };
    // Provision and sign in (the fixture did), act on a request, record revenue, apply an enforcement step.
    const id = await reservation(f, "2026-09-10", "2026-09-13");
    const production = setupRevenueRelease({ accounting: env().accountingRepository });
    const release = production.app.releaseRevenue("reservation-1", revenuePrincipal);
    pauseOperator(env());
    const grants = env().grantStore.listGrants();
    const requestStatus = env().bookingRequestApp.manager.getRequest(id).status;
    const auditBefore = env().audit.entries();
    const projections = env().enforcementManager.getProjections(scope);
    assert.ok(grants.some((grant) => !grant.revokedAtIso), "a representative grant is active");
    assert.ok(auditBefore.length > 0);

    await f.restart();

    assert.equal((await operatorGet({ base: f.server.base, cookie: f.initialCookie }, "/operator/requests")).status, 200, "the session issued before the restart still works");
    assert.deepEqual(env().grantStore.listGrants(), grants, "the representative grant survived");
    assert.equal(env().bookingRequestApp.manager.getRequest(id).status, requestStatus, "the request action survived");
    assert.deepEqual(env().accountingRepository.findReleaseByReservationId("reservation-1"), release, "revenue survived");
    assert.deepEqual(env().enforcementManager.getProjections(scope), projections, "enforcement survived");
    assert.deepEqual(env().audit.entries().slice(0, auditBefore.length), auditBefore, "the audit trail survived in order");
  } finally { await f.close(); }
});

test("06d AC3: With production: true, #demoRequests is never populated", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { LocalApartmentOwnerEnvironment } = await import("../apps/local-owner/src/index.js");
  const directory = await mkdtemp(join(tmpdir(), "owner-production-demo-"));
  const open = (production: boolean) => LocalApartmentOwnerEnvironment.openNode({ databasePath: join(directory, `${production ? "prod" : "demo"}.sqlite`), production });
  const demo = open(false);
  const production = open(true);
  try {
    // Control: the demo configuration does populate and show the list.
    demo.createDemoIncomingBookingRequest();
    assert.equal(demo.getStateOverview().pendingRequests.length, 1);

    // Failure path: production refuses to write it, and neither reads it.
    assert.throws(() => production.createDemoIncomingBookingRequest(), /not available in production/);
    assert.deepEqual(production.getStateOverview().pendingRequests, []);
  } finally {
    demo.close();
    production.close();
    await rm(directory, { recursive: true, force: true });
  }
});
