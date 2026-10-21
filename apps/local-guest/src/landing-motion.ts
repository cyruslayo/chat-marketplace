/**
 * Pure, DOM-free timing, visibility and pinning rules for the landing page motion script (issue 02). The DOM entry
 * (landing-page.ts) turns these numbers into timers and `hidden` toggles; the stage contract that names the elements is
 * in landing-page-html.ts (issue 01). Every sequence must end in under MOTION_LIMIT_MS (WCAG 2.2.2, ADR 0078).
 */

export const MOTION_LIMIT_MS = 5000;

/** Hero typing: the first character after 300 ms, then one character every 26 ms. */
export const TYPING_START_MS = 300;
export const TYPING_STEP_MS = 26;
/** Hero send press: the send control gets a class for this long, then stage 1 follows 200 ms later. */
export const SEND_PRESS_MS = 250;
export const SEND_TO_STAGE_MS = 200;
/** Hero gaps before stages 2, 3 and 4 (after stage 1). */
export const HERO_STAGE_GAPS_MS: readonly number[] = [500, 600, 900];

/** Beat gaps: the milliseconds before each stage, as the approved timings give them. */
export const BEAT_STAGE_GAPS_MS = {
  "beat-1": [300, 700, 700, 1000],
  "beat-2": [300, 900, 500, 500],
  "beat-3": [300, 500, 700, 600],
  "beat-4": [300, 600, 900, 1100],
  "beat-5": [300, 500, 350, 350, 700, 700],
} as const satisfies Record<string, readonly number[]>;

export type BeatId = keyof typeof BEAT_STAGE_GAPS_MS;
export type PlayId = "hero" | BeatId;

/** The share of a sequence's container that must be on screen before it plays (issue 02). */
export const PLAY_ENTER_RATIO = 0.35;
/** The middle band used to decide which beat caption is active while pinned (issue 02). */
export const ACTIVE_BAND_ROOT_MARGIN = "-45% 0px -45% 0px";

/** Desktop width (64rem) and the scroll ratio the page needs before the phone is pinned. */
export const PIN_MIN_VIEWPORT_WIDTH_PX = 1024;
export const PIN_MIN_SCROLL_RATIO = 1.5;

/** Running totals of the gaps: the time each stage starts, measured from the start of the sequence. */
export function cumulativeTimes(gaps: readonly number[]): number[] {
  const times: number[] = [];
  let total = 0;
  for (const gap of gaps) {
    total += gap;
    times.push(total);
  }
  return times;
}

/** When each typed character of the hero message appears (the first at 300 ms, one every 26 ms). */
export function heroTypingSteps(messageLength: number): { readonly at: number; readonly count: number }[] {
  return Array.from({ length: messageLength }, (_, index) => ({ at: TYPING_START_MS + TYPING_STEP_MS * index, count: index + 1 }));
}

/** When the hero's send press starts: one character step after the last character. */
export function heroSendPressAt(messageLength: number): number {
  return TYPING_START_MS + TYPING_STEP_MS * messageLength;
}

/** The stage times for one sequence. Hero needs the length of its message; the beats do not. */
export function sequenceStageTimes(playId: PlayId, messageLength = 0): number[] {
  if (playId === "hero") {
    const stageOne = heroSendPressAt(messageLength) + SEND_PRESS_MS + SEND_TO_STAGE_MS;
    return cumulativeTimes([stageOne, ...HERO_STAGE_GAPS_MS]);
  }
  return cumulativeTimes(BEAT_STAGE_GAPS_MS[playId]);
}

/** When the last stage of a sequence starts: the sequence's total length. */
export function sequenceDurationMs(playId: PlayId, messageLength = 0): number {
  const times = sequenceStageTimes(playId, messageLength);
  return times[times.length - 1] ?? 0;
}

/** A `data-landing-stage="k"` element is shown from stage k on. Stage 0 is the reset state (nothing shown). */
export function stageRevealed(stage: number, current: number): boolean {
  return Number.isInteger(stage) && stage >= 1 && current >= stage;
}

/** A `data-landing-only="k"` element is shown only during stage k. */
export function onlyVisible(stage: number, current: number): boolean {
  return Number.isInteger(stage) && stage >= 1 && current === stage;
}

export interface PinConditions {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly documentHeight: number;
  readonly hasIntersectionObserver: boolean;
}

/**
 * Pin one phone beside the captions only at desktop width, on a page taller than one and a half screens, and only when
 * IntersectionObserver exists to pick the active beat. Any failed condition keeps the beats inline.
 */
export function shouldPinPhone(conditions: PinConditions): boolean {
  return (
    conditions.hasIntersectionObserver &&
    conditions.viewportWidth >= PIN_MIN_VIEWPORT_WIDTH_PX &&
    conditions.documentHeight > PIN_MIN_SCROLL_RATIO * conditions.viewportHeight
  );
}
