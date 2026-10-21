"use strict";
(() => {
  // apps/local-guest/src/landing-motion.ts
  var MOTION_LIMIT_MS = 5e3;
  var TYPING_START_MS = 300;
  var TYPING_STEP_MS = 26;
  var SEND_PRESS_MS = 250;
  var SEND_TO_STAGE_MS = 200;
  var HERO_STAGE_GAPS_MS = [500, 600, 900];
  var BEAT_STAGE_GAPS_MS = {
    "beat-1": [300, 700, 700, 1e3],
    "beat-2": [300, 900, 500, 500],
    "beat-3": [300, 500, 700, 600],
    "beat-4": [300, 600, 900, 1100],
    "beat-5": [300, 500, 350, 350, 700, 700]
  };
  var PLAY_ENTER_RATIO = 0.35;
  var ACTIVE_BAND_ROOT_MARGIN = "-45% 0px -45% 0px";
  var PIN_MIN_VIEWPORT_WIDTH_PX = 1024;
  var PIN_MIN_SCROLL_RATIO = 1.5;
  function cumulativeTimes(gaps) {
    const times = [];
    let total = 0;
    for (const gap of gaps) {
      total += gap;
      times.push(total);
    }
    return times;
  }
  function heroTypingSteps(messageLength) {
    return Array.from({ length: messageLength }, (_, index) => ({ at: TYPING_START_MS + TYPING_STEP_MS * index, count: index + 1 }));
  }
  function heroSendPressAt(messageLength) {
    return TYPING_START_MS + TYPING_STEP_MS * messageLength;
  }
  function sequenceStageTimes(playId, messageLength = 0) {
    if (playId === "hero") {
      const stageOne = heroSendPressAt(messageLength) + SEND_PRESS_MS + SEND_TO_STAGE_MS;
      return cumulativeTimes([stageOne, ...HERO_STAGE_GAPS_MS]);
    }
    return cumulativeTimes(BEAT_STAGE_GAPS_MS[playId]);
  }
  function sequenceDurationMs(playId, messageLength = 0) {
    const times = sequenceStageTimes(playId, messageLength);
    return times[times.length - 1] ?? 0;
  }
  function stageRevealed(stage, current) {
    return Number.isInteger(stage) && stage >= 1 && current >= stage;
  }
  function onlyVisible(stage, current) {
    return Number.isInteger(stage) && stage >= 1 && current === stage;
  }
  function shouldPinPhone(conditions) {
    return conditions.hasIntersectionObserver && conditions.viewportWidth >= PIN_MIN_VIEWPORT_WIDTH_PX && conditions.documentHeight > PIN_MIN_SCROLL_RATIO * conditions.viewportHeight;
  }

  // apps/local-guest/src/landing-page.ts
  var PLAY_IDS = ["hero", "beat-1", "beat-2", "beat-3", "beat-4", "beat-5"];
  var ENTER_CLASS = "landing-enter";
  var PENDING_CLASS = "landing-pending";
  var TYPING_CLASS = "is-typing";
  var SENDING_CLASS = "is-sending";
  var PINNED_CLASS = "is-pinned";
  var ACTIVE_CLASS = "is-active";
  var DIM_CLASS = "is-dim";
  var APPBAR_STICKY_CLASS = "landing-appbar--sticky";
  var APPBAR_ON_PHOTO_CLASS = "landing-appbar--on-photo";
  var IDLE = { cancel: () => void 0 };
  var placeholders = /* @__PURE__ */ new WeakMap();
  function isPlayId(value) {
    return PLAY_IDS.some((id) => id === value);
  }
  function setShown(element, shown) {
    if (!shown) {
      element.hidden = true;
      return;
    }
    if (element.hidden) {
      element.hidden = false;
      element.classList.add(ENTER_CLASS);
    }
  }
  function setRevealed(element, revealed) {
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
  function applyStage(container, stage) {
    for (const element of container.querySelectorAll("[data-landing-stage]")) {
      setRevealed(element, stageRevealed(Number(element.dataset.landingStage), stage));
    }
    for (const element of container.querySelectorAll("[data-landing-only]")) {
      setShown(element, onlyVisible(Number(element.dataset.landingOnly), stage));
    }
  }
  function restoreFinal(container) {
    for (const element of container.querySelectorAll("[data-landing-stage]")) {
      element.classList.remove(PENDING_CLASS, ENTER_CLASS);
    }
    for (const element of container.querySelectorAll("[data-landing-only]")) element.hidden = true;
  }
  function visibleRatio(element) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return Math.max(0, visible) / rect.height;
  }
  function playSequence(container) {
    const playId = container.dataset.landingPlay;
    if (!isPlayId(playId)) return IDLE;
    const declared = Number(container.dataset.landingStages);
    const field = container.querySelector("[data-landing-field]");
    const send = container.querySelector(".landing-chat__send");
    const message = container.querySelector("[data-landing-message]")?.textContent ?? "";
    const times = sequenceStageTimes(playId, message.length);
    if (times.length === 0 || times.length !== declared || sequenceDurationMs(playId, message.length) >= MOTION_LIMIT_MS) return IDLE;
    const timers = [];
    const later = (at, run) => {
      timers.push(window.setTimeout(run, at));
    };
    const reset = () => {
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
  function watchHero(container) {
    let player;
    let armed = true;
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
      { threshold: [0, PLAY_ENTER_RATIO] }
    );
    observer.observe(container);
    return () => {
      observer.disconnect();
      player?.cancel();
      restoreFinal(container);
    };
  }
  function mountPinned(beatsRoot) {
    const captions = /* @__PURE__ */ new Map();
    const phones = /* @__PURE__ */ new Map();
    const screenWrappers = [];
    for (const caption of beatsRoot.querySelectorAll("[data-landing-caption]")) {
      captions.set(Number(caption.dataset.landingCaption), caption);
    }
    for (const phone of beatsRoot.querySelectorAll(".landing-beat [data-landing-screen]")) {
      phones.set(Number(phone.dataset.landingScreen), phone);
      const wrapper2 = phone.closest(".landing-beat__screen");
      if (wrapper2) screenWrappers.push(wrapper2);
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
    let activeIndex;
    let player;
    let copy;
    const crossing = /* @__PURE__ */ new Set();
    const played = /* @__PURE__ */ new Set();
    const setActive = (index) => {
      activeIndex = index;
      for (const [number, caption] of captions) {
        caption.classList.toggle(ACTIVE_CLASS, number === index);
        caption.classList.toggle(DIM_CLASS, number !== index);
        const step = caption.closest(".landing-beat");
        if (step) step.dataset.state = number < index ? "done" : number === index ? "current" : "upcoming";
      }
      player?.cancel();
      copy?.remove();
      const source = phones.get(index);
      if (source) {
        copy = source.cloneNode(true);
        copy.setAttribute("aria-hidden", "true");
        wrapper.append(copy);
        if (!played.has(index)) {
          played.add(index);
          player = playSequence(copy);
        }
      }
      live.textContent = captions.get(index)?.querySelector(".ui-eyebrow")?.textContent ?? "";
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number(entry.target.dataset.landingCaption);
          if (entry.isIntersecting) crossing.add(index);
          else crossing.delete(index);
        }
        if (crossing.size === 0) return;
        const next = Math.min(...crossing);
        if (next !== activeIndex) setActive(next);
      },
      { rootMargin: ACTIVE_BAND_ROOT_MARGIN, threshold: 0 }
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
        caption.closest(".landing-beat")?.removeAttribute("data-state");
      }
    };
  }
  function enhanceThemeSwitch() {
    const form = document.querySelector("form.landing-theme");
    if (!form) return;
    const buttons = [...form.querySelectorAll('button[name="theme"]')];
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
          body: new URLSearchParams({ theme })
        }).catch(() => void 0);
      });
    }
  }
  function enhanceExampleChips() {
    const field = document.querySelector("form.landing-composer input[type='text']");
    if (!field) return;
    for (const chip of document.querySelectorAll(".landing-suggest-row button.landing-suggest")) {
      chip.addEventListener("click", () => {
        field.value = chip.textContent ?? "";
        field.focus();
      });
    }
  }
  function enhanceAppBar() {
    const header = document.querySelector("header.ui-appbar");
    const hero = document.querySelector(".landing-hero");
    if (!header || !hero || !("IntersectionObserver" in window)) return;
    header.classList.add(APPBAR_STICKY_CLASS);
    const barHeight = Math.ceil(header.getBoundingClientRect().height);
    header.classList.toggle(APPBAR_ON_PHOTO_CLASS, hero.getBoundingClientRect().bottom > barHeight);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) header.classList.toggle(APPBAR_ON_PHOTO_CLASS, entry.isIntersecting);
      },
      { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(hero);
  }
  function start() {
    enhanceThemeSwitch();
    enhanceExampleChips();
    enhanceAppBar();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    for (const field of document.querySelectorAll("[data-landing-field]")) {
      placeholders.set(field, field.textContent ?? "");
    }
    const hero = document.querySelector('[data-landing-play="hero"]');
    const releaseHero = hero ? watchHero(hero) : () => void 0;
    const beatsRoot = document.querySelector(".landing-beats");
    let pinned;
    let unmount;
    let stopped = false;
    window.addEventListener("beforeprint", () => {
      stopped = true;
      unmount?.();
      unmount = void 0;
      pinned = void 0;
      releaseHero();
    });
    const sync = () => {
      if (stopped) return;
      const next = beatsRoot !== null && shouldPinPhone({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        hasIntersectionObserver: true
      });
      if (next === pinned) return;
      unmount?.();
      pinned = next;
      unmount = next && beatsRoot ? mountPinned(beatsRoot) : void 0;
    };
    sync();
    window.addEventListener("resize", sync, { passive: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
