import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUEST_MODE_CHOOSER, GUEST_MODES, guestModeSwitchAnnouncement, MODE_TEXT_MAX_LENGTH } from "../apps/web-agent/src/guest-content.js";
import { createModeAnnouncements } from "../apps/local-guest/src/mode-announcement.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

// Issue 03l (ADR 0107 decision 7; ADR 0078; ADR 0077): a committed mode switch is announced once through the polite announcer. A
// response that carries a reply and a switch is one combined polite write, switch copy first. Each criterion is one test.

const STAYS = GUEST_MODES.stays;
const SHOP = createFakeShopPack().presentation!;
const SOURCE = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
const SWITCH_COPY = guestModeSwitchAnnouncement(GUEST_MODE_CHOOSER.conciergeLabel(SHOP.label));
const REPLY = "Here are the shops near you.";

/** The client's announce() body, read from source, so the routing of polite and assertive text can be checked. */
function announceBody(): string {
  const match = /function announce\(text: string, assertive = false\): void \{[\s\S]*?\n\}/.exec(SOURCE);
  assert.ok(match, "announce() is present in client.ts");
  return match[0];
}

test("AC1: A response that changes the mode announces the switch copy once through the polite announcer", () => {
  const announcements = createModeAnnouncements();
  announcements.applyResponse(STAYS);
  announcements.applyResponse(SHOP);
  assert.equal(announcements.flush(), SWITCH_COPY, "the switch copy is held for the polite announcer");
  assert.equal(announcements.flush(), undefined, "the copy is written once, never again");
  assert.equal(announcements.politeText("Next reply."), "Next reply.", "a later polite write carries no repeat of the copy");
});

test("AC2: A response with the same mode id announces nothing", () => {
  const announcements = createModeAnnouncements();
  announcements.applyResponse(STAYS);
  announcements.applyResponse(STAYS);
  assert.equal(announcements.flush(), undefined);
  assert.equal(announcements.politeText("Reply."), "Reply.");
});

test("AC3: The first response after a page load announces nothing", () => {
  // Failure path inside the same criterion: a reload restores a non-default mode, and that restore is still no switch.
  const announcements = createModeAnnouncements();
  announcements.applyResponse(SHOP);
  assert.equal(announcements.flush(), undefined, "the first response is never a switch");
  assert.equal(announcements.politeText("Restored."), "Restored.");
});

test("AC4: The switch announcement uses the polite announcer; the assertive announcer stays empty", () => {
  const body = announceBody();
  // Assertive text is written straight to the error announcer and never receives the held switch copy.
  assert.match(body, /if \(assertive\) \{\s*errorAnnouncer\.textContent = text;\s*return;\s*\}/);
  assert.match(body, /announcer\.textContent = modeAnnouncements\.politeText\(text\);/);
  // Failure path: the polite branch is the only place the held copy is combined, so an error never carries it.
  assert.doesNotMatch(body, /errorAnnouncer\.textContent = modeAnnouncements/);
});

test("AC5: The switch copy comes from guest-content.ts, and a grep test finds no literal copy for it in client.ts", () => {
  assert.equal(SWITCH_COPY, `You’re now talking to ${GUEST_MODE_CHOOSER.conciergeLabel(SHOP.label)}.`, "one template, curly apostrophe");
  assert.equal(guestModeSwitchAnnouncement("Concierge · Stays"), "You’re now talking to Concierge · Stays.", "stays wording");
  assert.ok(SWITCH_COPY.length <= MODE_TEXT_MAX_LENGTH, "within the presentation text bound");
  // Failure path: no literal copy for a switch in the client, only the helper's import.
  assert.doesNotMatch(SOURCE, /talking to/);
  assert.doesNotMatch(SOURCE, /now talking/);
});

test("AC6: A response with a malformed mode is refused and announces nothing (fail closed)", () => {
  const malformed: readonly [string, unknown][] = [
    ["an unknown field", { ...SHOP, extra: "x" }],
    ["a missing persona", { ...SHOP, persona: undefined }],
    ["a bad icon", { ...SHOP, persona: { name: "Shop", icon: "not-an-icon" } }],
    ["a bad id", { ...SHOP, id: "Shop Mode" }],
    ["a string", "shop"],
    ["null", null],
  ];
  for (const [label, candidate] of malformed) {
    const announcements = createModeAnnouncements();
    announcements.applyResponse(STAYS);
    announcements.applyResponse(candidate);
    assert.equal(announcements.flush(), undefined, `refuses ${label} without a switch`);
    // The malformed mode does not move the last applied id, so the next valid switch is still one switch.
    announcements.applyResponse(SHOP);
    assert.equal(announcements.flush(), SWITCH_COPY, `a valid switch after ${label} is announced once`);
  }
});

test("AC7: A preview in the strip announces nothing", () => {
  // A preview creates no response and no switch: the preview functions never reach the announcer or the response mode.
  const previewChoose = /function previewChoose\(choice: ModeChoice\): void \{[\s\S]*?\n\}/.exec(SOURCE);
  const renderStrip = /function renderModeStrip\(\): void \{[\s\S]*?\n\}/.exec(SOURCE);
  assert.ok(previewChoose && renderStrip, "the preview functions are present");
  for (const [name, fn] of [["previewChoose", previewChoose[0]], ["renderModeStrip", renderStrip[0]]] as const) {
    assert.doesNotMatch(fn, /announce\(/, `${name} does not announce`);
    assert.doesNotMatch(fn, /applyResponse|applyResponseMode\(/, `${name} does not apply a response mode`);
  }
  // Failure path: a preview held as the mode never leaves a pending switch behind.
  const announcements = createModeAnnouncements();
  announcements.applyResponse(STAYS);
  assert.equal(announcements.flush(), undefined);
});

test("AC8: A response that carries both a reply and a switch announces each once, in the order chosen in owner decision 5", () => {
  const announcements = createModeAnnouncements();
  announcements.applyResponse(STAYS);
  announcements.applyResponse(SHOP);
  // One combined polite write: the switch copy first, then the reply, separated by a space.
  assert.equal(announcements.politeText(REPLY), `${SWITCH_COPY} ${REPLY}`);
  // Each announced once: nothing is left to write alone, and the next reply is not prefixed again.
  assert.equal(announcements.flush(), undefined);
  assert.equal(announcements.politeText("Another reply."), "Another reply.");
});
