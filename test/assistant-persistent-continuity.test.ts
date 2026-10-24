import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

const serverModel: AssistantModelClient = {
  generate: async (request) => {
    if (request.structuredOutput?.name === "concierge_scope") {
      const message = JSON.parse(request.history[0]?.role === "user" ? request.history[0].text : "{}") as { message?: string };
      const text = message.message?.toLowerCase() ?? "";
      const intents = text.includes("status") ? ["status"] : text.includes("draft") ? ["draft"] : text.includes("more") ? ["details"] : ["search"];
      return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents, reasonCode: "supported", slots: { city: "Lagos", neighbourhood: "Old Ikoyi", bedrooms: null, nights: 4, guests: 2, checkIn: null, checkOut: null } }) };
    }
    if (request.history.at(-1)?.role === "tool_results") return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
    const user = [...request.history].reverse().find((step) => step.role === "user");
    const text = user?.role === "user" ? user.text.toLowerCase() : "";
    if (text.includes("status")) return { toolCalls: [{ id: "status", name: "get_booking_status", args: {} }] };
    if (text.includes("draft")) return { toolCalls: [{ id: "draft", name: "prepare_request_draft", args: { stayRef: "stay-1", nights: 4, guests: 2 } }] };
    if (text.includes("more")) return { toolCalls: [{ id: "details", name: "get_unit_details", args: { stayRef: "stay-1" } }] };
    return { toolCalls: [{ id: "search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } }] };
  },
};

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
    if (status.ok) assert.match(status.messages[0] ?? "", /no active booking/i);
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
