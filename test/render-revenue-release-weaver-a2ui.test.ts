import test from "node:test";
import assert from "node:assert/strict";
import { setupRevenueRelease } from "./revenue-release-fixtures.js";
import { createRevenueReleaseWebAgentAdapter } from "../apps/web-agent/src/presentation.js";
import { A2UI_V091_BASIC_CATALOG_ID } from "@weaver/core";
test("Revenue Release uses the canonical read-only artifact through Weaver Basic Catalog", () => { const s = setupRevenueRelease(); s.app.releaseRevenue("reservation-1", { id: "system", role: "system", tenantId: "tenant" }); const view = createRevenueReleaseWebAgentAdapter({ application: s.app, principal: { id: "operator-1", role: "operator", tenantId: "tenant" }, createSurfaceId: (id) => `surface:${id}` }).get("reservation-1"); assert.equal(view.artifact.id, "revenue-release:reservation-1"); assert.equal(view.artifact.actions.length, 0); const create = view.a2uiMessages[0]; assert.ok("createSurface" in create); assert.equal(create.createSurface.catalogId, A2UI_V091_BASIC_CATALOG_ID); const text = JSON.stringify(view.a2uiMessages); assert.match(text, /payable|Rolling Reserve|Operator Net/); assert.doesNotMatch(text, /provider-reference|tenant|Guest|PAN|CVV|OTP|SecurityContext/i); });
