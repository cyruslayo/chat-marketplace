import { readResponseMode } from "./response-mode.js";

/**
 * Issue 03j (ADR 0107 decision 7; AGENTS.md "Browser support"): decides how a confirmed mode switch reaches the page. Free of DOM access
 * so node can drive it. The View Transitions call is passed in, so the fallbacks are testable without a browser:
 * typed (`types: ["mode-switch"]`), then untyped, then an instant update. The instant update is always correct.
 */

/** The transition type the mode-switch rules in the Guest UI kit are scoped to. */
export const MODE_SWITCH_TYPE = "mode-switch";

/** A View Transitions start: the typed form takes options, the untyped form takes the update callback. */
export type ModeSwitchStart = (options: unknown) => unknown;

export interface ModeSwitchEnvironment {
  /** document.startViewTransition, or undefined when the browser has no View Transitions API. */
  readonly start: ModeSwitchStart | undefined;
  /** prefers-reduced-motion: reduce. A reduced-motion switch starts no transition. */
  readonly reducedMotion: boolean;
  /** True while another view transition runs (document.activeViewTransition). A switch never starts over it. */
  readonly transitionRunning: boolean;
}

/** How the switch reached the page. */
export type ModeSwitchPath = "typed" | "untyped" | "instant";

/**
 * True when a response's mode is a valid presentation whose id differs from the document's data-mode. An absent or malformed mode, and
 * the same mode again, are not switches (ADR 0107 decision 6), so an ordinary turn never reaches the transition.
 */
export function modeSwitchChanges(currentModeId: string | undefined, value: unknown): boolean {
  const mode = readResponseMode(value);
  return mode !== undefined && mode.id !== currentModeId;
}

/**
 * Runs a confirmed mode switch's update. Typed first, untyped second, instant last. A promise a browser returns from the start call is
 * read so that an update that throws never becomes an unhandled rejection; the instant path rethrows nothing either.
 */
export function runModeSwitch(update: () => void, environment: ModeSwitchEnvironment): ModeSwitchPath {
  if (environment.start === undefined || environment.reducedMotion || environment.transitionRunning) {
    update();
    return "instant";
  }
  const start = environment.start;
  try {
    settle(start({ update, types: [MODE_SWITCH_TYPE] }));
    return "typed";
  } catch {
    /* A browser without transition types rejects the options object; the untyped form is the next step. */
  }
  try {
    settle(start(update));
    return "untyped";
  } catch {
    /* Both forms refused: the update still runs, without a transition. */
  }
  update();
  return "instant";
}

/** Reads the transition's promises so that a rejected update is not reported as an unhandled rejection. */
function settle(transition: unknown): void {
  if (typeof transition !== "object" || transition === null) return;
  for (const key of ["finished", "ready", "updateCallbackDone"]) {
    const promise = (transition as Record<string, unknown>)[key];
    if (typeof promise === "object" && promise !== null && typeof (promise as { then?: unknown }).then === "function") {
      (promise as Promise<unknown>).then(undefined, () => undefined);
    }
  }
}
