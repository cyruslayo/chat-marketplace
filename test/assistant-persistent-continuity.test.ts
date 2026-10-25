import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";
import { ModelRequestGuardError } from "../apps/local-guest/src/assistant/assistant-model.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { parseGuestProjection } from "../apps/local-guest/src/guest-projection.js";

const serverModel: AssistantModelClient = {
  generate: async (request) => {
    if (request.structuredOutput?.name === "concierge_scope") {
      const message = JSON.parse(request.history[0]?.role === "user" ? request.history[0].text : "{}") as { message?: string };
      const text = message.message?.toLowerCase() ?? "";
      if (text.includes("poem")) return { text: JSON.stringify({ scope: "out_of_scope", risk: "ordinary", intents: [], reasonCode: "outside", slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } }) };
      const intents = text.includes("support") || text.includes("locked out") ? ["support"] : text.includes("status") ? ["status"] : text.includes("draft") ? ["draft"] : text.includes("more") ? ["details"] : ["search"];
      return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents, reasonCode: "supported", slots: { city: "Lagos", neighbourhood: "Old Ikoyi", bedrooms: null, nights: 4, guests: 2, checkIn: null, checkOut: null } }) };
    }
    if (request.history.at(-1)?.role === "tool_results") return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
    const user = [...request.history].reverse().find((step) => step.role === "user");
    const text = user?.role === "user" ? user.text.toLowerCase() : "";
    if (text.includes("support") || text.includes("locked out")) return { text: JSON.stringify({ kind: "support_guidance", references: [] }) };
    if (text.includes("status")) return { toolCalls: [{ id: "status", name: "get_booking_status", args: {} }] };
    if (text.includes("draft")) return { toolCalls: [{ id: "draft", name: "prepare_request_draft", args: { stayRef: "stay-1", nights: 4, guests: 2 } }] };
    if (text.includes("more")) return { toolCalls: [{ id: "details", name: "get_unit_details", args: { stayRef: "stay-1" } }] };
    return { toolCalls: [{ id: "search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } }] };
  },
};

test("Mixed-request quota, storage, and provider failures retain unavailable wording after refresh and restart", async () => {
  for (const failure of ["quota_denied", "quota_unavailable", "provider_failure"] as const) {
    let armed = false;
    const model: AssistantModelClient = { generate: async (request) => {
      if (armed && request.structuredOutput?.name === "concierge_scope") return { text: JSON.stringify({
        scope: "mixed", risk: "ordinary", intents: ["search"], reasonCode: "mixed",
        slots: { city: "Lagos", neighbourhood: "Old Ikoyi", bedrooms: null, nights: 4, guests: 2, checkIn: null, checkOut: null },
      }) };
      if (armed) throw failure === "provider_failure" ? new Error("Synthetic provider failure") : new ModelRequestGuardError(failure);
      return serverModel.generate(request);
    } };
    const fixture = await restartFixture({}, { modelClient: model, conciergeMode: "assistant-offline" });
    try {
      assert.equal((await fixture.send("/api/turn", { text: "Find Ikoyi stays for four nights for two guests" })).ok, true);
      armed = true;
      const failed = await fixture.send("/api/turn", { text: "Find Old Ikoyi stays for 4 nights and 2 guests, and write a sorting program." });
      assert.equal(failed.ok, true);
      if (!failed.ok) return;
      assert.equal(failed.assistantControlOutcome, failure === "quota_denied" ? "quota_refusal" : failure === "quota_unavailable" ? "guard_failure" : "model_handling_failure");
      assert.deepEqual(failed.messages, [ASSISTANT_CONTROL_COPY.unavailable]);
      const current = await fixture.state();
      assert.equal(current.ok, true);
      if (current.ok) assert.equal(current.timeline.at(-1)?.text, ASSISTANT_CONTROL_COPY.unavailable);
      await fixture.restart();
      const restored = await fixture.state();
      assert.equal(restored.ok, true);
      if (restored.ok) assert.equal(restored.timeline.at(-1)?.text, ASSISTANT_CONTROL_COPY.unavailable);
    } finally { await fixture.close(); }
  }
});

test("A scope redirect keeps its fixed meaning in the timeline and after refresh", async () => {
  const fixture = await restartFixture({}, { modelClient: serverModel, conciergeMode: "assistant-offline" });
  try {
    const search = await fixture.send("/api/turn", { text: "Find Ikoyi stays for four nights for two guests" });
    assert.equal(search.ok, true);
    const redirect = await fixture.send("/api/turn", { text: "Write me a poem about stars" });
    assert.equal(redirect.ok, true);
    if (!redirect.ok) return;
    assert.match(redirect.messages[0] ?? "", /I can help you find accommodation/);
    const current = await fixture.state();
    assert.equal(current.ok, true);
    if (!current.ok) return;
    assert.equal(current.timeline.at(-1)?.text, redirect.messages[0]);
    await fixture.restart();
    const restored = await fixture.state();
    assert.equal(restored.ok, true);
    if (restored.ok) assert.equal(restored.timeline.at(-1)?.text, redirect.messages[0]);

    const support = await fixture.send("/api/turn", { text: "I am locked out of my stay and need support." });
    assert.equal(support.ok, true);
    if (!support.ok) return;
    assert.match(support.messages[0] ?? "", /Active-Stay Emergency Support/);
    const supportState = await fixture.state();
    assert.equal(supportState.ok, true);
    if (supportState.ok) assert.equal(supportState.timeline.at(-1)?.text, support.messages[0]);
    await fixture.restart();
    const restoredSupport = await fixture.state();
    assert.equal(restoredSupport.ok, true);
    if (restoredSupport.ok) assert.equal(restoredSupport.timeline.at(-1)?.text, support.messages[0]);
  } finally {
    await fixture.close();
  }
});

test("Assistant Shortlet search, detail, and draft continuity survive authenticated HTTP refreshes and application restarts", async () => {
  const fixture = await restartFixture({}, { modelClient: serverModel, conciergeMode: "assistant-offline" });
  try {
    const search = await fixture.send("/api/turn", { text: "Find Ikoyi stays for four nights for two guests" });
    assert.equal(search.ok, true);
    if (!search.ok) return;
    assert.equal(search.surfaces.length, 1);
    const stateAfterSearch = await fixture.state();
    assert.equal(stateAfterSearch.ok, true);
    if (!stateAfterSearch.ok) return;
    assert.ok(stateAfterSearch.timeline.length > 0, "the HTTP state route should restore a safe application timeline");
    assert.ok(stateAfterSearch.timeline.every((entry) => entry.role === "assistant"), "persisted Assistant turns must not retain raw guest prompt history");
    const storedAfterSearch = fixture.environment.interactionStore.findThread(fixture.threadId);
    assert.ok(storedAfterSearch);
    assert.doesNotMatch(storedAfterSearch!.threadJson, /conversationHistory|rawStep|Find Ikoyi stays/);
    const durableProjection = JSON.parse(storedAfterSearch!.threadJson) as { readonly assistantContext?: unknown; readonly discoveryArtifact?: unknown };
    assert.ok(durableProjection.assistantContext);
    assert.equal(durableProjection.discoveryArtifact, null, "external listing narrative is re-read from the current domain artifact");
    assert.equal(stateAfterSearch.surfaces.length, 1);

    await fixture.restart();
    const restoredSearch = await fixture.state();
    assert.equal(restoredSearch.ok, true);
    if (!restoredSearch.ok) return;
    assert.equal(restoredSearch.surfaces.length, 1, "the current authorized search surface should return after restart");
    const opened = await fixture.send("/api/event", guestAction(restoredSearch.surfaces[0]!, "shortlet.discovery.view-unit"));
    assert.equal(opened.ok, true, `the restored result action must still resolve against its current artifact: ${opened.ok ? "ok" : `${opened.code}: ${opened.message}`}`);
    if (!opened.ok) return;
    assert.match(opened.surfaces[0]?.surfaceId ?? "", /:unit:/);
    const details = await fixture.send("/api/turn", { text: "Tell me more about the first one" });
    assert.equal(details.ok, true);
    if (!details.ok) return;
    assert.match(details.surfaces[0]?.surfaceId ?? "", /:unit:/);

    await fixture.restart();
    const reopenedDetails = await fixture.state();
    assert.equal(reopenedDetails.ok, true);
    if (!reopenedDetails.ok) return;
    assert.match(reopenedDetails.surfaces[0]?.surfaceId ?? "", /:unit:/);
    const draft = await fixture.send("/api/turn", { text: "Prepare a Request Draft for the first one" });
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.match(draft.surfaces[0]?.surfaceId ?? "", /:request:draft:/);

    await fixture.restart();
    const reopenedDraft = await fixture.state();
    assert.equal(reopenedDraft.ok, true);
    if (!reopenedDraft.ok) return;
    assert.match(reopenedDraft.surfaces[0]?.surfaceId ?? "", /:request:draft:/);
    assert.ok(reopenedDraft.timeline.length > 0);
    const storedDraft = fixture.environment.interactionStore.findThread(fixture.threadId);
    assert.ok(storedDraft);
    assert.doesNotMatch(storedDraft!.threadJson, /Prepare a Request Draft|Tell me more|conversationHistory|rawStep|Luxury 2-Bedroom|paymentReference|occupants/);
    const status = await fixture.send("/api/turn", { text: "Check my booking status" });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.match(status.messages[0] ?? "", /no active booking/i);
      await fixture.restart();
      const restoredStatus = await fixture.state();
      assert.equal(restoredStatus.ok, true);
      if (restoredStatus.ok) assert.equal(restoredStatus.timeline.at(-1)?.text, status.messages[0]);
    }
    const draftSurface = reopenedDraft.surfaces[0]!;
    assert.match(draftSurface.conventionalRoute ?? "", /^\/booking-requests\/drafts\//);
    const draftId = draftSurface.conventionalRoute!.split("/").at(-1)!;
    const conventionalPage = await fetch(`${fixture.base}${draftSurface.conventionalRoute}`, { headers: { Cookie: fixture.cookie } });
    assert.equal(conventionalPage.status, 200, "the owner-checked conventional draft route survives restart");
    assert.match(await conventionalPage.text(), /Request Draft|Review your/);
    const reviewResponse = await fetch(`${fixture.base}${draftSurface.conventionalRoute}/review`, {
      method: "POST",
      headers: { Cookie: fixture.cookie, Origin: fixture.base, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ surfaceId: draftSurface.surfaceId }),
    });
    assert.equal(reviewResponse.status, 200, await reviewResponse.text());
    const reviewed = await fixture.state();
    assert.equal(reviewed.ok, true);
    if (reviewed.ok) assert.match(reviewed.surfaces[0]?.surfaceId ?? "", /:request:review:/);

    const wrongOwner = LocalGuestEnvironment.openNode({ databasePath: fixture.databasePath, guestId: "guest-other-owner" });
    try {
      const app = new LocalGuestApp(wrongOwner, { assistantRuntime: new AssistantRuntime(wrongOwner, serverModel) });
      assert.equal(app.getState(fixture.threadId), undefined, "a different principal cannot restore this assistant projection");
      assert.equal(await app.conventionalBookingPage("draft", draftId, wrongOwner.guestPrincipal()), null);
    } finally { wrongOwner.close(); }
    const wrongTenant = LocalGuestEnvironment.openNode({ databasePath: fixture.databasePath, tenantId: "tenant-other" });
    try {
      const app = new LocalGuestApp(wrongTenant, { assistantRuntime: new AssistantRuntime(wrongTenant, serverModel) });
      assert.equal(app.getState(fixture.threadId), undefined, "a different tenant cannot restore this assistant projection");
    } finally { wrongTenant.close(); }
  } finally {
    await fixture.close();
  }
});

test("A server demo date keeps its provenance through restart and a same-task location correction", async () => {
  const correctionModel: AssistantModelClient = {
    generate: async (request) => {
      const latestUser = [...request.history].reverse().find((step) => step.role === "user");
      if (request.structuredOutput?.name === "concierge_scope" && latestUser?.role === "user" && latestUser.text.includes("Ignore Ikoyi")) {
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", bedrooms: null, nights: 4, guests: 2, checkIn: null, checkOut: null } }) };
      }
      if (request.structuredOutput?.name !== "concierge_scope" && latestUser?.role === "user" && latestUser.text.includes("Ignore Ikoyi")) {
        return { toolCalls: [{ id: "corrected-search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-09-10", nights: 4, guests: 2 } }] };
      }
      return serverModel.generate(request);
    },
  };
  const fixture = await restartFixture({}, { modelClient: correctionModel, conciergeMode: "assistant-offline" });
  try {
    const search = await fixture.send("/api/turn", { text: "Find Ikoyi stays for four nights for two guests" });
    assert.equal(search.ok, true);
    if (!search.ok) return;
    const stored = fixture.environment.interactionStore.findThread(fixture.threadId);
    assert.ok(stored);
    const beforeRestart = JSON.parse(stored!.threadJson) as { readonly assistantContext?: { readonly checkIn?: string; readonly isDemoDate?: boolean } };
    assert.equal(beforeRestart.assistantContext?.checkIn, "2026-09-10");
    assert.equal(beforeRestart.assistantContext?.isDemoDate, true);

    await fixture.restart();
    const correction = await fixture.send("/api/turn", { text: "Ignore Ikoyi. Change the location to Lekki Phase 1 in Lagos. Keep 4 nights and 2 guests." });
    assert.equal(correction.ok, true, correction.ok ? "" : `${correction.code}: ${correction.message}`);
    if (!correction.ok) return;
    const restored = fixture.app.assistantRuntime?.getThread(fixture.threadId);
    assert.ok(restored, "the restored thread must be readable after the correction");
    assert.equal(restored.canonicalUserFactHistory?.includes("2026-09-10") ?? false, false, "restored server demo dates must not become guest-authored facts");
    assert.equal(restored?.taskState.stayIntent.neighbourhood, "Lekki Phase 1");
    assert.equal(restored?.taskState.stayIntent.checkIn, "2026-09-10");
    assert.equal(restored?.taskState.stayIntent.isDemoDate, true);
    assert.equal(restored?.taskState.stayIntent.nights, 4);
    assert.equal(restored?.taskState.stayIntent.partySize, 2);
    assert.match(JSON.stringify(correction.surfaces[0]), /Lekki Phase 1/, "the corrected discovery surface must reflect current criteria");
  } finally {
    await fixture.close();
  }
});

test("A guest-authored date remains guest-authored through restart and a same-task location correction", async () => {
  const authoredCheckIn = "2026-09-15";
  const authoredDateModel: AssistantModelClient = {
    generate: async (request) => {
      const latestUser = [...request.history].reverse().find((step) => step.role === "user");
      const isCorrection = latestUser?.role === "user" && latestUser.text.includes("Ignore Ikoyi");
      if (request.structuredOutput?.name === "concierge_scope" && latestUser?.role === "user") {
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: { city: "Lagos", neighbourhood: isCorrection ? "Lekki Phase 1" : "Old Ikoyi", bedrooms: null, nights: 4, guests: 2, checkIn: authoredCheckIn, checkOut: null } }) };
      }
      if (request.structuredOutput?.name !== "concierge_scope" && latestUser?.role === "user") {
        return { toolCalls: [{ id: "authored-date-search", name: "search_stays", args: { city: "Lagos", neighbourhood: isCorrection ? "Lekki Phase 1" : "Old Ikoyi", checkIn: authoredCheckIn, nights: 4, guests: 2 } }] };
      }
      return serverModel.generate(request);
    },
  };
  const fixture = await restartFixture({}, { modelClient: authoredDateModel, conciergeMode: "assistant-offline" });
  try {
    const search = await fixture.send("/api/turn", { text: `Find Ikoyi stays from ${authoredCheckIn} for four nights for two guests` });
    assert.equal(search.ok, true);
    if (!search.ok) return;
    const stored = fixture.environment.interactionStore.findThread(fixture.threadId);
    assert.ok(stored);
    const beforeRestart = JSON.parse(stored!.threadJson) as { readonly assistantContext?: { readonly checkIn?: string; readonly isDemoDate?: boolean } };
    assert.equal(beforeRestart.assistantContext?.checkIn, authoredCheckIn);
    assert.equal(beforeRestart.assistantContext?.isDemoDate, false);

    await fixture.restart();
    const correction = await fixture.send("/api/turn", { text: "Ignore Ikoyi. Change the location to Lekki Phase 1 in Lagos. Keep 4 nights and 2 guests." });
    assert.equal(correction.ok, true, correction.ok ? "" : `${correction.code}: ${correction.message}`);
    if (!correction.ok) return;
    const restored = fixture.app.assistantRuntime?.getThread(fixture.threadId);
    assert.equal(restored?.canonicalUserFactHistory?.includes(authoredCheckIn) ?? false, true, "restored guest-authored dates remain authorized facts");
    assert.equal(restored?.taskState.stayIntent.neighbourhood, "Lekki Phase 1");
    assert.equal(restored?.taskState.stayIntent.checkIn, authoredCheckIn);
    assert.equal(restored?.taskState.stayIntent.isDemoDate, false);
    assert.equal(restored?.taskState.stayIntent.nights, 4);
    assert.equal(restored?.taskState.stayIntent.partySize, 2);
  } finally {
    await fixture.close();
  }
});

test("A legacy restored date with unknown provenance cannot silently fall back to the demo date", async () => {
  const correctionModel: AssistantModelClient = {
    generate: async (request) => {
      const latestUser = [...request.history].reverse().find((step) => step.role === "user");
      if (request.structuredOutput?.name === "concierge_scope" && latestUser?.role === "user" && latestUser.text.includes("Ignore Ikoyi")) {
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", bedrooms: null, nights: 4, guests: 2, checkIn: null, checkOut: null } }) };
      }
      if (request.structuredOutput?.name !== "concierge_scope" && latestUser?.role === "user" && latestUser.text.includes("Ignore Ikoyi")) {
        return { toolCalls: [{ id: "legacy-correction", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: null, nights: 4, guests: 2 } }] };
      }
      return serverModel.generate(request);
    },
  };
  const fixture = await restartFixture({}, { modelClient: correctionModel, conciergeMode: "assistant-offline" });
  try {
    const search = await fixture.send("/api/turn", { text: "Find Ikoyi stays for four nights for two guests" });
    assert.equal(search.ok, true);
    if (!search.ok) return;
    const stored = fixture.environment.interactionStore.findThread(fixture.threadId);
    assert.ok(stored);
    const projection = JSON.parse(stored!.threadJson) as { readonly assistantContext?: Record<string, unknown> };
    assert.ok(projection.assistantContext);
    delete projection.assistantContext.isDemoDate;
    fixture.environment.interactionStore.saveThread({ ...stored!, threadJson: JSON.stringify(projection) });

    await fixture.restart();
    const correction = await fixture.send("/api/turn", { text: "Ignore Ikoyi. Change the location to Lekki Phase 1 in Lagos. Keep 4 nights and 2 guests." });
    assert.equal(correction.ok, false, "unknown restored provenance must fail closed instead of selecting a new demo date");
    if (!correction.ok) assert.equal(correction.code, "CONCIERGE_UNAVAILABLE");
    const restored = fixture.app.assistantRuntime?.getThread(fixture.threadId);
    assert.ok(restored, "the restored thread must be readable after the failed correction");
    assert.equal(restored.taskState.stayIntent.checkIn, "2026-09-10");
    assert.equal(restored.taskState.stayIntent.isDemoDate, undefined);
    assert.equal(restored.canonicalUserFactHistory?.includes("2026-09-10") ?? false, false, "a legacy server-owned date must not be promoted into guest-authored facts");
  } finally {
    await fixture.close();
  }
});

test("A guest projection with a non-boolean isDemoDate is rejected by the parser", () => {
  const projection = {
    version: 1,
    timeline: [],
    discoverySurfaceId: "surface",
    discoveryRevision: 0,
    discoveryArtifact: null,
    unitDetail: null,
    draftId: null,
    draftQuote: null,
    requestId: null,
    offerId: null,
    activeStage: null,
    activeSurfaceId: null,
    assistantContext: { city: "Lagos", checkIn: "2026-09-10", isDemoDate: "false" },
  };
  assert.notEqual(parseGuestProjection({ ...projection, assistantContext: { ...projection.assistantContext, isDemoDate: true } }), null, "the same projection with a boolean isDemoDate must parse");
  assert.equal(parseGuestProjection(projection), null, "a string isDemoDate must fail closed instead of being coerced");
});
