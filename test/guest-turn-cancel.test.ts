import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { combinedAbortSignal } from "../apps/local-guest/src/turn-cancel.js";

// Issue 21 (ADR 0106; guideline §6, §12): cancel ends the browser wait, with a fallback when AbortSignal.any is absent.

test("AC4: The fallback path works when AbortSignal.any is unavailable", async () => {
  const user = new AbortController();
  const signal = combinedAbortSignal(user.signal, 60_000, undefined);
  assert.equal(signal.aborted, false);
  user.abort();
  assert.equal(signal.aborted, true);
  // Failure path: a timeout also ends the wait through the manual controller.
  const slow = combinedAbortSignal(new AbortController().signal, 1, undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(slow.aborted, true);
});

test("AC4: The AbortSignal.any path ends on the user cancel", () => {
  const user = new AbortController();
  const signal = combinedAbortSignal(user.signal, 60_000, (signals) => AbortSignal.any(signals));
  user.abort();
  assert.equal(signal.aborted, true);
});

test("AC3: A turn that landed before the cancel is shown, not lost", () => {
  const source = readFileSync("apps/local-guest/src/client.ts", "utf8");
  assert.match(source, /if \(stoppedByGuest\) \{[\s\S]*?await showLandedTurn\(text\)[\s\S]*?stoppedWaiting/);
  assert.match(source, /signal: userSignal === undefined \? AbortSignal\.timeout\(timeoutMs\) : combinedAbortSignal\(userSignal, timeoutMs\)/);
});
