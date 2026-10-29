import assert from "node:assert/strict";
import test from "node:test";
import { turnEntriesSince, type RecoveryTimelineEntry } from "../apps/local-guest/src/guest-turn-recovery.js";

const timeline: readonly RecoveryTimelineEntry[] = [
  { role: "user", text: "Find stays in Lekki" },
  { role: "assistant", text: "I found 3 matching stays in Lekki." },
  { role: "user", text: "2 guests" },
  { role: "assistant", text: "Updated for 2 guests." },
];

test("Turn recovery AC1: a message that is the thread's latest user entry has landed and returns the reply entries after it", () => {
  const landed: readonly RecoveryTimelineEntry[] = [...timeline.slice(0, 3), { role: "assistant", text: "Still searching." }];
  assert.deepEqual(turnEntriesSince(landed, "2 guests"), [{ role: "assistant", text: "Still searching." }]);
});

test("Turn recovery AC2: a message missing from the thread has not landed, so the guest may retry (fail closed)", () => {
  assert.equal(turnEntriesSince(timeline, "Show me Ikoyi"), undefined);
  assert.equal(turnEntriesSince([], "2 guests"), undefined, "an empty thread holds no landed turn");
});

test("Turn recovery AC3: an earlier identical message does not count once a later user message is in the thread", () => {
  const laterUser: readonly RecoveryTimelineEntry[] = [
    { role: "user", text: "2 guests" },
    { role: "assistant", text: "Updated for 2 guests." },
    { role: "user", text: "Show me Ikoyi" },
  ];
  assert.equal(turnEntriesSince(laterUser, "2 guests"), undefined, "the latest user entry decides, so the unsent turn is retried");
});

test("Turn recovery AC4: only entries after the matching user message are returned, never earlier history", () => {
  const entries = turnEntriesSince(timeline, "2 guests");
  assert.deepEqual(entries, [{ role: "assistant", text: "Updated for 2 guests." }]);
  assert.ok(!entries?.some((entry) => entry.text === "Find stays in Lekki"));
});

test("Turn recovery AC5: a user message without any assistant reply has landed and returns no entries", () => {
  const pending: readonly RecoveryTimelineEntry[] = [{ role: "user", text: "2 guests" }];
  assert.deepEqual(turnEntriesSince(pending, "2 guests"), []);
});
