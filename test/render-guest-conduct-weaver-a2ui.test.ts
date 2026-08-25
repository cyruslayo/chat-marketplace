import test from "node:test";
import assert from "node:assert/strict";
import { guestConductArtifactToA2UI } from "../apps/web-agent/src/guest-conduct-a2ui.js";
import { createGuestConductPolicySnapshot } from "../domains/shortlet/src/index.js";
import { guestConductArtifactFromState } from "../apps/web/src/guest-conduct-artifact.js";
const p = createGuestConductPolicySnapshot({ unitId: "u", capacity: 2 });
const artifact = guestConductArtifactFromState({ reservationId: "r", contractId: "c", policy: p, viewer: { id: "op", role: "operator", tenantId: "t" }, allegation: { allegationId: "a", reservationId: "r", ruleId: "quiet_hours", ruleVersion: p.ruleVersion, allegationVersion: 2, state: "cure_pending", safeSummary: "Safe summary", evidenceSetId: "opaque", evidenceVersion: "e1", warningCode: "CONDUCT_CURE_REQUIRED", cureWindowMinutes: 30, cureDeadline: "2026-01-01T00:30:00Z", humanOwned: false } });
test("Guest Conduct Weaver mapper is deterministic, Basic Catalog, and redacted", () => { const messages = guestConductArtifactToA2UI({ artifact, surfaceId: "surface" }); assert.equal(messages[0].version, "v0.9.1"); assert.deepEqual(messages, guestConductArtifactToA2UI({ artifact, surfaceId: "surface" })); const serialized = JSON.stringify(messages); assert.match(serialized, /22:00.*08:00|22:00–08:00/); assert.match(serialized, /cure_pending|CONDUCT_CURE_REQUIRED/); assert.doesNotMatch(serialized, /opaque|tenant|responder|evidenceSetId/); });
