/**
 * The landing page's motion script (landing PRD, issue 02). It enhances the server-rendered stage markup from
 * landing-page-html.ts and does nothing when reduced motion is requested or IntersectionObserver is missing: the server
 * HTML already shows every final state. The timings and visibility rules live in landing-motion.ts; this file only
 * schedules them and toggles the `hidden` attribute and classes. Text changes only in the hero message box while typing.
 */
import {
  ACTIVE_BAND_ROOT_MARGIN,
  MOTION_LIMIT_MS,
  PLAY_ENTER_RATIO,
  SEND_PRESS_MS,
  heroSendPressAt,
  heroTypingSteps,
  onlyVisible,
  sequenceDurationMs,
  sequenceStageTimes,
  shouldPinPhone,
  stageRevealed,
  type PlayId,
} from "./landing-motion.js";

const PLAY_IDS: readonly PlayId[] = ["hero", "beat-1", "beat-2", "beat-3", "beat-4", "beat-5"];
const ENTER_CLASS = "landing-enter";
/** A staged element not yet revealed: it keeps its layout space (visibility, not display), so the page never reflows. */
const PENDING_CLASS = "landing-pending";
/** On the hero message box while typing and sending: the field keeps the newest characters in view. */
const TYPING_CLASS = "is-typing";
const SENDING_CLASS = "is-sending";
const PINNED_CLASS = "is-pinned";
const ACTIVE_CLASS = "is-active";
const DIM_CLASS = "is-dim";
/** App bar (issue 09): sticky with JavaScript; on the photo while the hero is in view, solid once it has scrolled out. */
const APPBAR_STICKY_CLASS = "landing-appbar--sticky";
const APPBAR_ON_PHOTO_CLASS = "landing-appbar--on-photo";

interface Player {
  /** Stops the sequence and returns the container to its reset state (nothing staged is shown). */
  cancel(): void;
}

const IDLE: Player = { cancel: () => undefined };

/** The hero message box's server text, restored when the typed text is cleared. */
const placeholders = new WeakMap<HTMLElement, string>();

function isPlayId(value: string | undefined): value is PlayId {
  return PLAY_IDS.some((id) => id === value);
}

function setShown(element: HTMLElement, shown: boolean): void {
  if (!shown) {
    element.hidden = true;
    return;
  }
  if (element.hidden) {
    element.hidden = false;
    element.classList.add(ENTER_CLASS);
  }
}

/** A stage element keeps its space; revealing it removes the pending class and runs the entrance once. */
function setRevealed(element: HTMLElement, revealed: boolean): void {
  if (revealed) {
    if (element.classList.contains(PENDING_CLASS)) {
      element.classList.remove(PENDING_CLASS);
      element.classList.add(ENTER_CLASS);
    }
    return;
  }
  element.classList.add(PENDING_CLASS);
  element.classList.remove(ENTER_CLASS);
}

/** Applies one stage to a container: stage elements from their stage on, only-elements during their own stage. */
function applyStage(container: HTMLElement, stage: number): void {
  for (const element of container.querySelectorAll<HTMLElement>("[data-landing-stage]")) {
    setRevealed(element, stageRevealed(Number(element.dataset.landingStage), stage));
  }
  for (const element of container.querySelectorAll<HTMLElement>("[data-landing-only]")) {
    setShown(element, onlyVisible(Number(element.dataset.landingOnly), stage));
  }
}

/** The server HTML's final state: every stage element shown, every transient element hidden. */
function restoreFinal(container: HTMLElement): void {
  for (const element of container.querySelectorAll<HTMLElement>("[data-landing-stage]")) {
    element.classList.remove(PENDING_CLASS, ENTER_CLASS);
  }
  for (const element of container.querySelectorAll<HTMLElement>("[data-landing-only]")) element.hidden = true;
}

/** The share of a container's height inside the viewport right now (0 to 1). Measured on the final layout. */
function visibleRatio(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return Math.max(0, visible) / rect.height;
}

/** Plays one container's sequence from its reset state, on timers. Returns a player that can stop and reset it. */
function playSequence(container: HTMLElement): Player {
  const playId = container.dataset.landingPlay;
  if (!isPlayId(playId)) return IDLE;
  const declared = Number(container.dataset.landingStages);
  const field = container.querySelector<HTMLElement>("[data-landing-field]");
  const send = container.querySelector<HTMLElement>(".landing-chat__send");
  const message = container.querySelector<HTMLElement>("[data-landing-message]")?.textContent ?? "";
  const times = sequenceStageTimes(playId, message.length);
  // The markup must declare exactly the stages the timeline has, and the sequence must stay under the limit.
  if (times.length === 0 || times.length !== declared || sequenceDurationMs(playId, message.length) >= MOTION_LIMIT_MS) return IDLE;

  const timers: number[] = [];
  const later = (at: number, run: () => void): void => {
    timers.push(window.setTimeout(run, at));
  };
  const reset = (): void => {
    for (const timer of timers.splice(0)) window.clearTimeout(timer);
    applyStage(container, 0);
    if (field) {
      field.textContent = placeholders.get(field) ?? "";
      field.classList.remove(TYPING_CLASS);
    }
    send?.classList.remove(SENDING_CLASS);
  };

  reset();
  if (playId === "hero" && field && send) {
    for (const step of heroTypingSteps(message.length)) {
      later(step.at, () => {
        field.textContent = message.slice(0, step.count);
        field.classList.add(TYPING_CLASS);
      });
    }
    const press = heroSendPressAt(message.length);
    later(press, () => send.classList.add(SENDING_CLASS));
    later(press + SEND_PRESS_MS, () => send.classList.remove(SENDING_CLASS));
  }
  times.forEach((at, index) => {
    later(at, () => {
      if (index === 0 && field) {
        field.textContent = placeholders.get(field) ?? "";
        field.classList.remove(TYPING_CLASS);
      }
      applyStage(container, index + 1);
    });
  });
  return { cancel: reset };
}

/**
 * The hero plays once (issue 09): its sequence runs when at least 35% of the chat window is in view, and never again, so
 * scrolling back does not replay it. Its final state is the server markup, which is what the script leaves behind.
 */
function watchHero(container: HTMLElement): () => void {
  let player: Player | undefined;
  let armed = true;
  // The hero plays on load (issue 08): its chat window peeks in below the fold on phones, so it starts at the top of the page
  // whatever is visible. Otherwise it waits in its reset state until 35% of it is in view.
  if (window.scrollY < 1 || visibleRatio(container) >= PLAY_ENTER_RATIO) {
    armed = false;
    player = playSequence(container);
  } else {
    playSequence(container).cancel();
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (armed && entry.intersectionRatio >= PLAY_ENTER_RATIO) {
          armed = false;
          player = playSequence(container);
        }
      }
    },
    { threshold: [0, PLAY_ENTER_RATIO] },
  );
  observer.observe(container);
  return () => {
    observer.disconnect();
    player?.cancel();
    restoreFinal(container);
  };
}

/**
 * Desktop pinning: one phone beside the captions. The inline beat screens are hidden; the active beat's screen is cloned
 * into the sticky phone and played there each time its caption becomes active.
 */
function mountPinned(beatsRoot: HTMLElement): () => void {
  const captions = new Map<number, HTMLElement>();
  const phones = new Map<number, HTMLElement>();
  const screenWrappers: HTMLElement[] = [];
  for (const caption of beatsRoot.querySelectorAll<HTMLElement>("[data-landing-caption]")) {
    captions.set(Number(caption.dataset.landingCaption), caption);
  }
  for (const phone of beatsRoot.querySelectorAll<HTMLElement>(".landing-beat [data-landing-screen]")) {
    phones.set(Number(phone.dataset.landingScreen), phone);
    const wrapper = phone.closest<HTMLElement>(".landing-beat__screen");
    if (wrapper) screenWrappers.push(wrapper);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "landing-pinned";
  const live = document.createElement("p");
  live.className = "landing-live";
  live.setAttribute("aria-live", "polite");
  wrapper.append(live);
  beatsRoot.append(wrapper);
  beatsRoot.classList.add(PINNED_CLASS);
  for (const screen of screenWrappers) screen.hidden = true;

  let activeIndex: number | undefined;
  let player: Player | undefined;
  let copy: HTMLElement | undefined;
  const crossing = new Set<number>();
  const played = new Set<number>();

  const setActive = (index: number): void => {
    activeIndex = index;
    for (const [number, caption] of captions) {
      caption.classList.toggle(ACTIVE_CLASS, number === index);
      caption.classList.toggle(DIM_CLASS, number !== index);
      // The progress line (issue 08 sub-task B) reads the step state from its list item while pinned.
      const step = caption.closest<HTMLElement>(".landing-beat");
      if (step) step.dataset.state = number < index ? "done" : number === index ? "current" : "upcoming";
    }
    player?.cancel();
    copy?.remove();
    const source = phones.get(index);
    if (source) {
      copy = source.cloneNode(true) as HTMLElement;
      copy.setAttribute("aria-hidden", "true");
      wrapper.append(copy);
      // Each beat plays once per pinned session; scrolling back reactivates it in its final state (issue 09).
      if (!played.has(index)) {
        played.add(index);
        player = playSequence(copy);
      }
    }
    // The live region names only the active beat, from the caption's own step eyebrow.
    live.textContent = captions.get(index)?.querySelector(".ui-eyebrow")?.textContent ?? "";
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.landingCaption);
        if (entry.isIntersecting) crossing.add(index);
        else crossing.delete(index);
      }
      if (crossing.size === 0) return;
      const next = Math.min(...crossing);
      if (next !== activeIndex) setActive(next);
    },
    { rootMargin: ACTIVE_BAND_ROOT_MARGIN, threshold: 0 },
  );
  for (const caption of captions.values()) observer.observe(caption);

  return () => {
    observer.disconnect();
    player?.cancel();
    copy?.remove();
    wrapper.remove();
    beatsRoot.classList.remove(PINNED_CLASS);
    for (const screen of screenWrappers) screen.hidden = false;
    for (const caption of captions.values()) {
      caption.classList.remove(ACTIVE_CLASS, DIM_CLASS);
      caption.closest<HTMLElement>(".landing-beat")?.removeAttribute("data-state");
    }
  };
}

/**
 * Light/dark switch (issue 04). The server form works without JavaScript (a POST and a redirect). With JavaScript the
 * click applies the theme at once and saves it in the background; if the save fails, the visual change stays.
 */
function enhanceThemeSwitch(): void {
  const form = document.querySelector<HTMLFormElement>("form.landing-theme");
  if (!form) return;
  const buttons = [...form.querySelectorAll<HTMLButtonElement>('button[name="theme"]')];
  for (const button of buttons) {
    button.addEventListener("click", (event) => {
      const theme = button.value;
      if (theme !== "light" && theme !== "dark") return;
      event.preventDefault();
      document.documentElement.dataset.theme = theme;
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
      void fetch("/welcome/theme", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ theme }),
      }).catch(() => undefined);
    });
  }
}

/**
 * Example chips (issue 08 AC8): with JavaScript a chip fills the hero field with its text and focuses it. It never submits.
 * Without JavaScript the chips are buttons that do nothing, and the field stays empty.
 */
function enhanceExampleChips(): void {
  const field = document.querySelector<HTMLInputElement>("form.landing-composer input[type='text']");
  if (!field) return;
  for (const chip of document.querySelectorAll<HTMLButtonElement>(".landing-suggest-row button.landing-suggest")) {
    chip.addEventListener("click", () => {
      field.value = chip.textContent ?? "";
      field.focus();
    });
  }
}

/**
 * The app bar with JavaScript (issue 09): sticky, and on the photo while the hero is in view. Only a class changes, driven by
 * an IntersectionObserver. The bar's height is taken out of the flow (negative margin) and the hero's content is padded by the
 * same amount (shortlet-landing.css), so the headline never moves. Without IntersectionObserver the bar stays static and solid.
 */
function enhanceAppBar(): void {
  const header = document.querySelector<HTMLElement>("header.ui-appbar");
  const hero = document.querySelector<HTMLElement>(".landing-hero");
  if (!header || !hero || !("IntersectionObserver" in window)) return;
  header.classList.add(APPBAR_STICKY_CLASS);
  const barHeight = Math.ceil(header.getBoundingClientRect().height);
  // The hero counts as in view until its bottom edge has passed under the bar.
  header.classList.toggle(APPBAR_ON_PHOTO_CLASS, hero.getBoundingClientRect().bottom > barHeight);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) header.classList.toggle(APPBAR_ON_PHOTO_CLASS, entry.isIntersecting);
    },
    { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 },
  );
  observer.observe(hero);
}

function start(): void {
  enhanceThemeSwitch();
  enhanceExampleChips();
  enhanceAppBar();
  // Reduced motion or no IntersectionObserver: no motion at all, the server HTML is the final state (issue 02, ADR 0078).
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;

  for (const field of document.querySelectorAll<HTMLElement>("[data-landing-field]")) {
    placeholders.set(field, field.textContent ?? "");
  }
  // The hero is not part of the layout-dependent pinning below: it plays once and is never mounted again on resize.
  const hero = document.querySelector<HTMLElement>('[data-landing-play="hero"]');
  const releaseHero = hero ? watchHero(hero) : (): void => undefined;
  // Below desktop width, or when the page does not scroll enough, the beats are not played at all (issue 09).
  const beatsRoot = document.querySelector<HTMLElement>(".landing-beats");
  let pinned: boolean | undefined;
  let unmount: (() => void) | undefined;
  let stopped = false;
  // Printing shows every final state: stop the motion and restore the server markup. Afterprint leaves it final.
  window.addEventListener("beforeprint", () => {
    stopped = true;
    unmount?.();
    unmount = undefined;
    pinned = undefined;
    releaseHero();
  });
  const sync = (): void => {
    if (stopped) return;
    const next = beatsRoot !== null && shouldPinPhone({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      hasIntersectionObserver: true,
    });
    if (next === pinned) return;
    unmount?.();
    pinned = next;
    unmount = next && beatsRoot ? mountPinned(beatsRoot) : undefined;
  };
  sync();
  window.addEventListener("resize", sync, { passive: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
