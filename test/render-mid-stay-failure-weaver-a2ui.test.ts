import test from "node:test";
import assert from "node:assert/strict";
import { A2UI_V091_BASIC_CATALOG_ID } from "@weaver/core";
import { createMidStayFailureWebAgentAdapter } from "../apps/web-agent/src/presentation.js";
import { makeApplication } from "./mid-stay-fixtures.js";

test("Mid-Stay Failure Weaver uses Basic Catalog and generated strict action context", () => {
  const { app } = makeApplication(false);
  app.reportFailure({ reservationId: "reservation-1", evidenceReferenceIds: ["opaque-evidence-1"] }, { id: "guest-1", role: "guest", tenantId: "tenant-1" });
  const result = createMidStayFailureWebAgentAdapter({ application: app, principal: { id: "guest-1", role: "guest", tenantId: "tenant-1" }, createSurfaceId: (id) => `surface:${id}` }).get("reservation-1");
  assert.equal(result.channel, "web-agent"); assert.ok("createSurface" in result.a2uiMessages[0]); if ("createSurface" in result.a2uiMessages[0]) assert.equal(result.a2uiMessages[0].createSurface.catalogId, A2UI_V091_BASIC_CATALOG_ID); assert.equal(result.a2uiMessages[0].version, "v0.9.1");
  const rendered = JSON.stringify(result.a2uiMessages); assert.match(rendered, /Mid-Stay Support/); assert.doesNotMatch(rendered, /opaque-evidence|photo|video|private note/i);
  const update = result.a2uiMessages[1]; assert.ok("updateComponents" in update); const action = update.updateComponents.components.find((component) => component.id === "midstay-action"); assert.ok(action && "action" in action); const context = (action.action as unknown as { event: { context: Record<string, unknown> } }).event.context; assert.equal("type" in context, false); assert.equal("tenantId" in context, false); assert.equal(result.fallback.conventionalRoute, "/reservations/reservation-1/mid-stay-failure");
});
