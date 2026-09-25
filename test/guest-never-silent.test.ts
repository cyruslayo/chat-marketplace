import test from "node:test";
import assert from "node:assert/strict";
import { guestAction, restartFixture, type RestartStage } from "./helpers/guest-restart.js";
import type { GuestTurnResult } from "../apps/local-guest/src/guest-server.js";

function replyOf(result: GuestTurnResult): string {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.messages.join(" ") : "";
}

test("AC1: Every guest message gets an assistant reply in every workflow state", async () => {
  const fixture = await restartFixture();
  const silent: string[] = [];
  const replied: RestartStage[] = [];
  try {
    await fixture.advance("confirmed", async (stage) => {
      const turn = await fixture.send("/api/turn", { text: "hello, what happens now?" });
      // Failure path: a turn that returns no assistant message is recorded as silent.
      if (!turn.ok || turn.messages.length === 0) silent.push(stage);
      else replied.push(stage);
    });
  } finally { await fixture.close(); }
  assert.deepEqual(silent, []);
  assert.deepEqual(replied, ["discovery", "inspection", "draft", "review", "pending", "offer", "payment-ready", "handoff", "deposit-ready", "deposit-handoff", "confirmed"]);
});

test("AC2: \"is there parking\" is answered from unit amenities, or with a statement that it isn't listed", async () => {
  const ikoyi = await restartFixture();
  try {
    const answers = new Map<RestartStage, string>();
    await ikoyi.advance("pending", async (stage) => {
      if (stage === "inspection" || stage === "pending") answers.set(stage, replyOf(await ikoyi.send("/api/turn", { text: "is there parking?" })));
    });
    assert.match(answers.get("inspection") ?? "", /Yes: Luxury 2-Bedroom Apartment in Old Ikoyi lists Secure parking\./);
    // The answer still comes from the Unit after the Booking Request is sent.
    assert.match(answers.get("pending") ?? "", /lists Secure parking/);
  } finally { await ikoyi.close(); }

  const lekki = await restartFixture();
  try {
    const search = await lekki.send("/api/turn", { text: "I need an apartment in Lekki from 10 Sept for 2 nights for 2 people" });
    assert.equal(search.ok, true); if (!search.ok) return;
    const detail = await lekki.send("/api/event", guestAction(search.surfaces[0]!));
    assert.equal(detail.ok, true);
    // Failure path: an amenity the Unit does not list is never claimed.
    const reply = replyOf(await lekki.send("/api/turn", { text: "is there parking?" }));
    assert.match(reply, /Parking isn't listed for .*Lekki.*, so I can't confirm it\./);
    assert.doesNotMatch(reply, /\bYes\b/);
  } finally { await lekki.close(); }
});

test("AC4: \"make it 3 nights\" on a submitted Booking Request never changes it silently; the reply explains the amendment path or why none exists", async () => {
  const fixture = await restartFixture();
  try {
    let pendingChecked = false;
    await fixture.advance("confirmed", async (stage, result) => {
      if (stage !== "pending") return;
      const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
      const before = fixture.environment.bookingRequestApp.getArtifact(requestId, fixture.environment.guestPrincipal()).facts;

      const reply = replyOf(await fixture.send("/api/turn", { text: "actually can we make it 5 nights? and is there parking?" }));
      assert.match(reply, /A sent Booking Request can't be changed/);
      assert.match(reply, /choose not to accept the offer at no cost/);
      assert.match(reply, /Nothing has been changed\./);
      // Both questions in one message are answered.
      assert.match(reply, /lists Secure parking/);

      // Failure path: the request itself is untouched and no second request exists.
      const after = fixture.environment.bookingRequestApp.getArtifact(requestId, fixture.environment.guestPrincipal()).facts;
      assert.equal(after.nights, before.nights);
      assert.equal(after.checkOut, before.checkOut);
      assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 1);
      pendingChecked = true;
    });
    assert.equal(pendingChecked, true);

    // After confirmation, the reply points to the versioned amendment path (ADR-0060).
    const confirmedReply = replyOf(await fixture.send("/api/turn", { text: "make it 5 nights" }));
    assert.match(confirmedReply, /booking amendment/);
    assert.match(confirmedReply, /Nothing has been changed\./);
  } finally { await fixture.close(); }
});
