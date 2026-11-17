import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUEST_MODES } from "../apps/web-agent/src/guest-content.js";
import { applyResponseModeTo } from "../apps/local-guest/src/response-mode.js";
import {
  MODE_SWITCH_TYPE,
  modeSwitchChanges,
  runModeSwitch,
  type ModeSwitchEnvironment,
  type ModeSwitchStart,
} from "../apps/local-guest/src/mode-switch-transition.js";

/*
 * Issue 03j of the agent-modes effort (ADR 0107 decision 7, decision 9, ADR 0078; AGENTS.md "Browser support"). The pure decision
 * (should a confirmed switch transition, typed or untyped, or run instantly) is node-importable; the client glue stays thin. AC 9 and
 * AC 10 are real Chrome (test/agent-mode-view-transition-chromium.test.ts).
 */

const CLIENT_SOURCE = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** A recording View Transitions start. Options with a `types` member are the typed form; a function is the untyped form. */
function recordingStart(behaviour: "ok" | "typed-throws" | "both-throw" = "ok") {
  const calls: unknown[] = [];
  const start: ModeSwitchStart = (options) => {
    calls.push(options);
    if (typeof options !== "function" && behaviour !== "ok") throw new TypeError("startViewTransition: argument is not a function");
    if (typeof options === "function" && behaviour === "both-throw") throw new TypeError("startViewTransition: unsupported");
    if (typeof options === "function") (options as () => void)();
    else (options as { update: () => void }).update();
    return {};
  };
  return { calls, start };
}

function environment(start: ModeSwitchStart | undefined, overrides: Partial<ModeSwitchEnvironment> = {}): ModeSwitchEnvironment {
  return { start, reducedMotion: false, transitionRunning: false, ...overrides };
}

test("AC1: A confirmed mode switch calls startViewTransition with the type mode-switch when the typed form is supported", () => {
  const { calls, start } = recordingStart("ok");
  let updated = 0;
  const path = runModeSwitch(() => { updated += 1; }, environment(start));
  assert.equal(path, "typed");
  assert.equal(calls.length, 1, "one transition is started");
  const options = calls[0] as { types?: unknown; update?: unknown };
  assert.deepEqual(options.types, [MODE_SWITCH_TYPE], "the typed call names the mode-switch type");
  assert.equal(MODE_SWITCH_TYPE, "mode-switch");
  assert.equal(updated, 1, "the update runs once inside the transition");
});

test("AC2: A confirmed mode switch with no startViewTransition applies the mode instantly and sets data-mode correctly", () => {
  const root: { dataset: Record<string, string | undefined> } = { dataset: {} };
  const path = runModeSwitch(() => { applyResponseModeTo(root, GUEST_MODES.stays); }, environment(undefined));
  assert.equal(path, "instant");
  assert.equal(root.dataset.mode, GUEST_MODES.stays.id, "data-mode is set from the validated presentation");
});

test("AC3: A confirmed mode switch under prefers-reduced-motion: reduce runs the update with no transition call", () => {
  const { calls, start } = recordingStart("ok");
  let updated = 0;
  const path = runModeSwitch(() => { updated += 1; }, environment(start, { reducedMotion: true }));
  assert.equal(path, "instant");
  assert.equal(calls.length, 0, "no transition is started under reduced motion");
  assert.equal(updated, 1, "the update still runs");
});

test("AC4: A typed call that throws falls back to the untyped form, and if that throws too the update still runs", () => {
  const untyped = recordingStart("typed-throws");
  let updatedOnce = 0;
  const path = runModeSwitch(() => { updatedOnce += 1; }, environment(untyped.start));
  assert.equal(path, "untyped", "the untyped form is used after the typed call throws");
  assert.equal(untyped.calls.length, 2, "the typed call and then the untyped call are attempted");
  assert.equal(typeof untyped.calls[1], "function", "the fallback passes the update callback alone");
  assert.equal(updatedOnce, 1, "the update runs exactly once");

  const both = recordingStart("both-throw");
  let updated = 0;
  const instant = runModeSwitch(() => { updated += 1; }, environment(both.start));
  assert.equal(instant, "instant", "when both forms throw the update is applied directly");
  assert.equal(updated, 1, "the instant update still runs");
});

test("AC5: An ordinary turn that does not switch mode starts no mode-switch transition", () => {
  const { calls, start } = recordingStart("ok");
  const stays = GUEST_MODES.stays.id;
  assert.equal(modeSwitchChanges(stays, GUEST_MODES.stays), false, "the same mode is not a switch");
  assert.equal(modeSwitchChanges(stays, undefined), false, "an absent mode is not a switch");
  assert.equal(modeSwitchChanges(stays, { id: "not-a-mode" }), false, "a malformed mode is not a switch");
  assert.equal(modeSwitchChanges(undefined, GUEST_MODES.stays), true, "a first valid mode differing from the page is a change");
  if (modeSwitchChanges(stays, GUEST_MODES.stays)) runModeSwitch(() => undefined, environment(start));
  assert.equal(calls.length, 0, "an unchanged mode starts no transition");
});

test("AC6: The first-message hero transition behaves as before (its guard test still passes unchanged)", () => {
  const start = CLIENT_SOURCE.indexOf("function withAgentMarkTransition(update: () => void): void {");
  assert.ok(start >= 0, "withAgentMarkTransition is present");
  const end = CLIENT_SOURCE.indexOf("\n}\n", start);
  const body = CLIENT_SOURCE.slice(start, end).replace(/\r/g, "");
  assert.match(body, /if \(emptyState\.hidden \|\| !document\.startViewTransition \|\| window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) \{/, "the hero guard is unchanged");
  assert.match(body, /document\.startViewTransition\(update\);/, "the hero path calls the untyped form");
  assert.doesNotMatch(body, /types/, "the hero path never passes a transition type");
  assert.doesNotMatch(body, /mode-switch/, "the hero path does not use the mode-switch type");
});

/** The mode-switch block of the Guest UI kit, from its marker to the end of the no-preference media block that holds it. */
function modeSwitchBlock(): { block: string; mediaStart: number; blockStart: number; blockEnd: number } {
  const marker = "/* Issue 03j (ADR 0107 decision 7)";
  const blockStart = FOUNDATIONS_CSS.indexOf(marker);
  assert.ok(blockStart >= 0, "the Issue 03j mode-switch block is in the kit");
  const mediaStart = FOUNDATIONS_CSS.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", blockStart);
  assert.ok(mediaStart >= 0, "the block sits after a no-preference media query");
  let depth = 0;
  let blockEnd = -1;
  for (let index = mediaStart + "@media (prefers-reduced-motion: no-preference) ".length; index < FOUNDATIONS_CSS.length; index += 1) {
    const char = FOUNDATIONS_CSS[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) { blockEnd = index; break; }
    }
  }
  assert.ok(blockEnd > blockStart, "the no-preference media query closes after the block");
  return { block: FOUNDATIONS_CSS.slice(blockStart, blockEnd), mediaStart, blockStart, blockEnd };
}

test("AC7: The cross-fade rules apply only under :active-view-transition-type(mode-switch) (a stylesheet test)", () => {
  const { block } = modeSwitchBlock();
  const selectors = block.split("}").map((rule) => rule.slice(0, rule.indexOf("{")).trim()).filter((selector) => selector.includes("::view-transition"));
  assert.ok(selectors.length >= 2, "the block styles the root cross-fade");
  for (const selector of selectors) {
    assert.match(selector, /:active-view-transition-type\(mode-switch\)/, `"${selector}" is scoped to the mode-switch type`);
  }
  assert.ok(block.includes(":root:active-view-transition-type(mode-switch) .ui-appbar"), "the app bar keeps its shared name only during a mode switch");
  assert.ok(block.includes(":root:active-view-transition-type(mode-switch) form#composer"), "the composer keeps its shared name only during a mode switch");
  assert.ok(block.includes(":root:active-view-transition-type(mode-switch) .mode-mark"), "the persona keeps its shared name only during a mode switch");
});

test("AC8: The cross-fade rules sit inside prefers-reduced-motion: no-preference (a stylesheet test)", () => {
  const { block, mediaStart, blockStart, blockEnd } = modeSwitchBlock();
  assert.ok(mediaStart < blockStart && blockStart < blockEnd, "the block is nested in the no-preference media query");
  assert.equal(FOUNDATIONS_CSS.slice(mediaStart, mediaStart + "@media (prefers-reduced-motion: no-preference) {".length), "@media (prefers-reduced-motion: no-preference) {", "the enclosing media query is no-preference");
  assert.doesNotMatch(block, /prefers-reduced-motion: reduce/, "the block adds no reduce branch of its own");
  assert.match(block, /var\(--duration-base\)/, "the cross-fade uses the base duration token");
  assert.match(block, /var\(--ease-standard\)/, "the cross-fade uses the standard easing token");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, "the block uses tokens only, no hex values");
});

test("Owner decision 3: a mode switch never starts over a running transition, so it cannot overlap the hero transition", () => {
  const { calls, start } = recordingStart("ok");
  let updated = 0;
  const path = runModeSwitch(() => { updated += 1; }, environment(start, { transitionRunning: true }));
  assert.equal(path, "instant", "a running transition makes the switch instant");
  assert.equal(calls.length, 0, "no transition is started over the running one");
  assert.equal(updated, 1, "the update still runs once");
});
