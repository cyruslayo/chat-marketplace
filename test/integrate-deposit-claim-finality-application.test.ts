import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import { InMemoryDepositClaimRepository, type DepositClaimProductionRecord } from "../domains/shortlet/src/deposit-claim.js";
import { InMemorySecurityDepositAccountingRepository } from "../domains/shortlet/src/security-deposit-accounting.js";
import { DepositClaimApplication } from "../apps/web/src/deposit-claim-application.js";
import type { BookingContract, Reservation } from "../domains/shortlet/src/card-payment.js";
import { depositClaimArtifact } from "../apps/web/src/deposit-claim-artifact.js";
import { createDepositClaimWebAgentAdapter } from "../apps/web-agent/src/presentation.js";

const guest = { id: "guest-27", role: "guest" as const, tenantId: "tenant-27" };
const staff = { id: "staff-27", role: "authorized_staff" as const, tenantId: "tenant-27" };
import { setupIssue27AuthorityCase as setup } from "./support/issue27-fixture.js";


test("Production full-decision receipt is separate from Issue 26 notice and direct viewing is replay-safe", () => { const s = setup(); const before = s.claims.findByClaimId("deposit-claim:res-27")!; assert.equal(before.finality?.appealWindowStartsAt, null); assert.equal(s.app.recordDecisionNotice(before.claimId, "guest", { id: "system-27", role: "system", tenantId: "tenant-27" }).decisionNotices?.[0].receiptEstablishedAtIso, "2026-09-03T10:00:00.000Z"); const viewed = s.app.recordDecisionViewed(before.claimId, "guest", guest); assert.equal(viewed.decisionNotices?.[0].receiptEstablishedAtIso, "2026-09-03T10:00:00.000Z"); assert.equal(s.app.recordDecisionViewed(before.claimId, "guest", guest).claimVersion, viewed.claimVersion); assert.equal(new Date(viewed.decisionNotices?.[0].appealWindowEndsAtIso!).getTime() - new Date(viewed.decisionNotices?.[0].receiptEstablishedAtIso!).getTime(), 7 * 24 * 60 * 60 * 1000); });

test("Canonical Issue 27 artifact uses deterministic WAT facts and Weaver Basic Catalog without provider leakage", () => { const s = setup(); const claim = s.claims.findByClaimId("deposit-claim:res-27")!; s.app.recordDecisionNotice(claim.claimId, "guest", { id: "system-27", role: "system", tenantId: "tenant-27" }); const artifact = depositClaimArtifact(s.app, "res-27", guest); const rendered = createDepositClaimWebAgentAdapter({ application: s.app, principal: guest, createSurfaceId: (id) => `surface:${id}` }).get("res-27"); assert.equal(rendered.artifact.projectionVersion, artifact.projectionVersion); assert.match(artifact.facts.appealDeadlineWAT ?? "", /2026/); assert.match(JSON.stringify(rendered.a2uiMessages), /v0.9.1/); assert.doesNotMatch(JSON.stringify(artifact), /deposit-source|providerReference|SecurityContext|session|device|auth token|private URL/i); });

test("Production guest acceptance is not a waiver and only a specific authenticated waiver grants finality", () => { const s = setup(); const claim = s.claims.findByClaimId("deposit-claim:res-27")!; assert.throws(() => s.app.waiveAppeal(claim.claimId, guest, { decisionId: "decision-27", decisionVersion: "v1" }), /STALE_ACTION/); s.app.recordDecisionNotice(claim.claimId, "guest", { id: "system-27", role: "system", tenantId: "tenant-27" }); const artifactBefore = depositClaimArtifact(s.app, "res-27", guest); assert.equal(artifactBefore.facts.decisionReceipt?.status, "received"); const waived = s.app.waiveAppeal(claim.claimId, guest, { decisionId: "decision-27", decisionVersion: "v1" }); assert.equal(waived.finality?.cause, null); assert.equal(waived.finality?.status, "appeal_window_open"); assert.equal(s.app.waiveAppeal(claim.claimId, guest, { decisionId: "decision-27", decisionVersion: "v1" }).claimVersion, waived.claimVersion); assert.throws(() => s.app.advanceClaimFinality(claim.claimId, { id: "other", role: "authorized_staff", tenantId: "other" }), /ACTION_NOT_AUTHORIZED/); void staff; });
