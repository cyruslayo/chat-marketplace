import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { focusAttemptExpression, synchronousFocusExpression, waitForStableFocus, type FocusAttemptResult } from "./helpers/focus-stability.js";

function createFocusAttempt(window: Window, frames: (callback: FrameRequestCallback) => number, frameTimeoutMs = 120) {
  type Evaluator = (document: Document, requestAnimationFrame: (callback: FrameRequestCallback) => number) => Promise<FocusAttemptResult>;
  const evaluate = new Function("document", "requestAnimationFrame", `return ${focusAttemptExpression("#composer-input", frameTimeoutMs)};`) as Evaluator;
  return () => evaluate(window.document as unknown as Document, frames);
}

test("focus retries after a surface steals focus, then requires two stable animation frames", async () => {
  const window = new Window();
  const input = window.document.createElement("input");
  input.id = "composer-input";
  const competingControl = window.document.createElement("button");
  window.document.body.append(input, competingControl);
  let frameNumber = 0;
  const frames = (callback: FrameRequestCallback): number => setTimeout(() => {
    frameNumber += 1;
    if (frameNumber === 1) competingControl.focus();
    if (frameNumber === 2) input.focus();
    callback(frameNumber);
  }, 0) as unknown as number;

  await waitForStableFocus(createFocusAttempt(window, frames), 500, 1);
  assert.equal(window.document.activeElement, input);
  assert.ok(frameNumber >= 4, "the focus check retries after the delayed focus change");
  window.happyDOM.abort();
});

test("focus attempt reports active focus when a background tab does not deliver animation frames", async () => {
  const window = new Window();
  const input = window.document.createElement("input");
  input.id = "composer-input";
  window.document.body.append(input);
  const startedAt = Date.now();
  const attempt = createFocusAttempt(window, () => 0, 20);

  assert.equal(await attempt(), "active");
  assert.ok(Date.now() - startedAt < 500, "the browser-side frame wait has a deadline");
  window.happyDOM.abort();
});

test("no-JavaScript focus uses synchronous native focus and still requires two active polls", async () => {
  const window = new Window();
  const input = window.document.createElement("input");
  input.id = "composer-input";
  window.document.body.append(input);
  type SynchronousEvaluator = (document: Document) => FocusAttemptResult;
  const evaluate = new Function("document", `return ${synchronousFocusExpression("#composer-input")};`) as SynchronousEvaluator;
  let polls = 0;

  const focused = await waitForStableFocus(async () => {
    polls += 1;
    return evaluate(window.document as unknown as Document);
  }, 100, 1);

  assert.equal(focused, true);
  assert.equal(polls, 2);
  assert.equal(window.document.activeElement, input);
  window.happyDOM.abort();
});

test("focus polling returns false when the browser evaluation never resolves", async () => {
  const startedAt = Date.now();
  const success = await waitForStableFocus(() => new Promise<boolean>(() => undefined), 30, 1);

  assert.equal(success, false);
  assert.ok(Date.now() - startedAt < 500, "the CDP evaluation wait has a deadline");
});

test("focus rejects a persistent trap that steals focus on every animation frame", async () => {
  const window = new Window();
  const input = window.document.createElement("input");
  input.id = "composer-input";
  const competingControl = window.document.createElement("button");
  window.document.body.append(input, competingControl);
  const frames = (callback: FrameRequestCallback): number => setTimeout(() => {
    competingControl.focus();
    callback(0);
  }, 0) as unknown as number;

  assert.equal(await waitForStableFocus(createFocusAttempt(window, frames), 30, 1), false);
  assert.equal(window.document.activeElement, competingControl);
  window.happyDOM.abort();
});
