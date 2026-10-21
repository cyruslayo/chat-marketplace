import assert from "node:assert/strict";
import test from "node:test";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import {
  BEAT_STAGE_GAPS_MS,
  MOTION_LIMIT_MS,
  onlyVisible,
  heroSendPressAt,
  heroTypingSteps,
  sequenceDurationMs,
  sequenceStageTimes,
  shouldPinPhone,
  stageRevealed,
  type PlayId,
} from "../apps/local-guest/src/landing-motion.js";

// Issue 02 (landing motion script): the pure, DOM-free timing, visibility and pinning rules.

const PLAY_IDS: readonly PlayId[] = ["hero", "beat-1", "beat-2", "beat-3", "beat-4", "beat-5"];

function markupMessage(): string {
  const match = /data-landing-message>([^<]+)</.exec(renderLandingHtml());
  assert.ok(match, "the hero bubble carries the message");
  return match[1]!;
}

function declaredStages(playId: PlayId): number {
  const pattern = new RegExp(`data-landing-play="${playId}" data-landing-stages="(\\d+)"`);
  const match = pattern.exec(renderLandingHtml());
  assert.ok(match, `${playId} declares its stage count in the markup`);
  return Number(match[1]);
}

test("AC3 — the hero types the message one character every 26 ms from 300 ms, then presses send, then posts stage 1", () => {
  const message = markupMessage();
  const steps = heroTypingSteps(message.length);
  assert.equal(steps.length, message.length);
  assert.equal(steps[0]!.at, 300, "typing starts after 300 ms");
  assert.equal(steps[1]!.at - steps[0]!.at, 26, "one character every 26 ms");
  assert.equal(steps.at(-1)!.at, 300 + 26 * (message.length - 1));
  assert.equal(heroSendPressAt(message.length), 300 + 26 * message.length, "the send press follows the last character");
  const hero = sequenceStageTimes("hero", message.length);
  assert.equal(hero[0], heroSendPressAt(message.length) + 250 + 200, "stage 1 is 250 ms of press and 200 ms later");
  assert.deepEqual(hero.slice(1).map((time, index) => time - hero[index]!), [500, 600, 900], "stages 2 to 4 follow at +500, +600, +900");
});

test("AC4 — each beat's stages play in order at the gaps given in the issue", () => {
  assert.deepEqual(BEAT_STAGE_GAPS_MS["beat-1"], [300, 700, 700, 1000]);
  assert.deepEqual(BEAT_STAGE_GAPS_MS["beat-2"], [300, 900, 500, 500]);
  assert.deepEqual(BEAT_STAGE_GAPS_MS["beat-3"], [300, 500, 700, 600]);
  assert.deepEqual(BEAT_STAGE_GAPS_MS["beat-4"], [300, 600, 900, 1100]);
  assert.deepEqual(BEAT_STAGE_GAPS_MS["beat-5"], [300, 500, 350, 350, 700, 700]);
  assert.deepEqual(sequenceStageTimes("beat-1"), [300, 1000, 1700, 2700]);
  for (const id of ["beat-1", "beat-2", "beat-3", "beat-4", "beat-5"] as const) {
    const times = sequenceStageTimes(id);
    assert.ok(times.every((time, index) => index === 0 || time > times[index - 1]!), `${id} stages are strictly ordered`);
  }
});

test("AC5 — every landing sequence finishes in under five seconds", () => {
  assert.equal(MOTION_LIMIT_MS, 5000);
  for (const id of PLAY_IDS) {
    const duration = sequenceDurationMs(id, markupMessage().length);
    assert.ok(duration < 5000, `${id} ends at ${duration} ms`);
  }
  assert.ok(sequenceDurationMs("hero", markupMessage().length) > 4000, "the hero is about 4.1 s, not an accidental zero");
});

test("AC5 — the timeline has one time per stage the markup declares", () => {
  for (const id of PLAY_IDS) {
    const times = sequenceStageTimes(id, markupMessage().length);
    assert.equal(times.length, declaredStages(id), `${id} stage count matches data-landing-stages`);
  }
});

test("AC6 — a stage element is shown from its stage on, and an only element only during its own stage", () => {
  assert.equal(stageRevealed(2, 0), false, "nothing is shown before stage 1");
  assert.equal(stageRevealed(2, 1), false, "stage 2 is hidden during stage 1");
  assert.equal(stageRevealed(2, 2), true, "stage 2 is shown from stage 2");
  assert.equal(stageRevealed(2, 4), true, "and stays shown to the final stage");
  assert.equal(onlyVisible(3, 2), false);
  assert.equal(onlyVisible(3, 3), true, "an only element shows during its stage");
  assert.equal(onlyVisible(3, 4), false, "and is hidden after it");
});

test("AC7 — the pinning decision holds at 1024 px and up on a page taller than one and a half screens, with IntersectionObserver", () => {
  assert.equal(shouldPinPhone({ viewportWidth: 1024, viewportHeight: 800, documentHeight: 1201, hasIntersectionObserver: true }), true);
  assert.equal(shouldPinPhone({ viewportWidth: 1280, viewportHeight: 800, documentHeight: 5000, hasIntersectionObserver: true }), true);
});

test("AC8 — below desktop width, on a short page, or without IntersectionObserver, nothing is pinned", () => {
  assert.equal(shouldPinPhone({ viewportWidth: 1023, viewportHeight: 800, documentHeight: 5000, hasIntersectionObserver: true }), false, "one pixel under desktop width");
  assert.equal(shouldPinPhone({ viewportWidth: 390, viewportHeight: 800, documentHeight: 5000, hasIntersectionObserver: true }), false, "a phone");
  assert.equal(shouldPinPhone({ viewportWidth: 1280, viewportHeight: 800, documentHeight: 1200, hasIntersectionObserver: true }), false, "exactly one and a half screens does not scroll enough");
  assert.equal(shouldPinPhone({ viewportWidth: 1280, viewportHeight: 800, documentHeight: 900, hasIntersectionObserver: true }), false, "a short page");
  assert.equal(shouldPinPhone({ viewportWidth: 1280, viewportHeight: 800, documentHeight: 5000, hasIntersectionObserver: false }), false, "no IntersectionObserver");
});
