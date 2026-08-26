import test from "node:test";
import assert from "node:assert/strict";
import { setupRevenueRelease, revenueNow } from "./revenue-release-fixtures.js";
import { journal } from "../domains/shortlet/src/revenue-accounting.js";
import { createRevenueReleaseWebAgentAdapter } from "../apps/web-agent/src/presentation.js";
import { A2UI_V091_BASIC_CATALOG_ID } from "@weaver/core";
test("Revenue Release uses the canonical read-only artifact through Weaver Basic Catalog", () => { const s = setupRevenueRelease(); const release = s.app.releaseRevenue("reservation-1", { id: "system", role: "system", tenantId: "tenant" }); const view = createRevenueReleaseWebAgentAdapter({ application: s.app, principal: { id: "operator-1", role: "operator", tenantId: "tenant" }, createSurfaceId: (id) => `surface:${id}` }).get("reservation-1"); assert.equal(view.artifact.id, "revenue-release:reservation-1"); assert.equal(view.artifact.actions.length, 0); assert.equal(view.artifact.facts.status, "released"); assert.equal(view.artifact.facts.protectionWindowStartsAt, release.protectionWindowStartsAt); const create = view.a2uiMessages[0]; assert.ok("createSurface" in create); assert.equal(create.createSurface.catalogId, A2UI_V091_BASIC_CATALOG_ID); const text = JSON.stringify(view.a2uiMessages); assert.match(text, /payable|Rolling Reserve|Operator Net/); assert.doesNotMatch(text, /provider-reference|tenant|Guest|PAN|CVV|OTP|SecurityContext/i); });

test("Weaver projects pending protection and blocked states without financial actions", () => {
  const pending = setupRevenueRelease({ clock: () => new Date("2026-09-02T11:59:59.999Z") });
  const pendingView = createRevenueReleaseWebAgentAdapter({ application: pending.app, principal: { id: "operator-1", role: "operator", tenantId: "tenant" }, createSurfaceId: (id) => `surface:${id}` }).get("reservation-1");
  assert.equal(pendingView.artifact.facts.status, "pending_protection_window");
  assert.equal(pendingView.artifact.actions.length, 0);
  const blocked = setupRevenueRelease({ accessStatus: "awaiting_access" });
  const blockedView = createRevenueReleaseWebAgentAdapter({ application: blocked.app, principal: { id: "operator-1", role: "operator", tenantId: "tenant" }, createSurfaceId: (id) => `surface:${id}` }).get("reservation-1");
  assert.equal(blockedView.artifact.facts.status, "awaiting_access");
  assert.equal(blockedView.artifact.actions.length, 0);
});

test("Weaver projects released adjustments from the canonical artifact", () => {
  const adjustment = { adjustmentId: "adjustment-weaver", adjustmentVersion: 1, reservationId: "reservation-1", releaseId: "revenue-release:reservation-1", source: "remedy" as const, sourceReference: "mid-stay-failure:reservation-1", reasonCode: "accepted_remedy", journal: journal({ correlationId: "revenue-release:reservation-1", createdAt: revenueNow.toISOString(), lines: [{ lineId: "debit", account: "operator_net_recognized" as const, side: "debit" as const, amountKobo: 10, currency: "NGN" as const }, { lineId: "credit", account: "operator_payable" as const, side: "credit" as const, amountKobo: 10, currency: "NGN" as const }] }) };
  const s = setupRevenueRelease({ adjustment }); s.app.releaseRevenue("reservation-1", { id: "system", role: "system", tenantId: "tenant" }); s.app.postAdjustment(adjustment.adjustmentId, { id: "system", role: "system", tenantId: "tenant" });
  const view = createRevenueReleaseWebAgentAdapter({ application: s.app, principal: { id: "operator-1", role: "operator", tenantId: "tenant" }, createSurfaceId: (id) => `surface:${id}` }).get("reservation-1");
  assert.equal(view.artifact.facts.status, "released"); assert.equal((view.artifact.facts.adjustmentSummary as readonly unknown[]).length, 1); assert.equal(view.artifact.actions.length, 0); assert.doesNotMatch(JSON.stringify(view.a2uiMessages), /Release button|Pay button|Adjust button/);
});
