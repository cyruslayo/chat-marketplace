/**
 * The founding partners page's script (landing issue 17). It enhances the server HTML of partners-page-html.ts and
 * partners-demo-html.ts, which is complete without it: the demo becomes one stage with controls, and the application form is
 * checked before it is sent. The server checks again and is the authority.
 */
import {
  firstWrongField,
  partnerErrorLine,
  partnerInputFromForm,
  validatePartnerApplication,
  type PartnerApplicationErrors,
} from "./partner-application.js";

/** The fade at the foot of a screen is 24px tall: shown only when more than that remains below (design pass 11). */
const FADE_PX = 24;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scrolls one screen inside itself, so its must-see parts clear the sticky bar and the fade. The window never moves. */
function showMustSee(screen: HTMLElement, smooth: boolean): void {
  const bar = screen.querySelector<HTMLElement>("[data-demo-bar]");
  const barHeight =
    bar !== null && getComputedStyle(bar).position === "sticky"
      ? bar.offsetHeight
      : 0;
  const focal = screen.querySelector<HTMLElement>("[data-demo-focal]");
  if (focal === null) {
    screen.scrollTop = 0;
    return;
  }
  const mustSee = [
    focal,
    ...screen.querySelectorAll<HTMLElement>("[data-demo-keep]"),
  ];
  const top = screen.getBoundingClientRect().top - screen.scrollTop;
  const lowest = Math.max(
    ...mustSee.map((item) => item.getBoundingClientRect().bottom - top),
  );
  const highest = focal.getBoundingClientRect().top - top;
  const view = screen.clientHeight - barHeight - FADE_PX;
  const target = Math.min(Math.max(0, lowest - view), highest);
  screen.scrollTo({
    top: target,
    behavior: smooth && !reducedMotion() ? "smooth" : "instant",
  });
}

function updateFade(screen: HTMLElement): void {
  const fade = screen.parentElement?.querySelector<HTMLElement>(
    ".xp-screen__fade",
  );
  if (!fade) return;
  const more =
    screen.scrollHeight - screen.clientHeight - screen.scrollTop > FADE_PX;
  fade.classList.toggle("is-on", more);
  const bar = screen.querySelector<HTMLElement>("[data-demo-bar]");
  const sticky = bar !== null && getComputedStyle(bar).position === "sticky";
  fade.style.bottom = sticky ? `${bar.offsetHeight}px` : "0px";
}

function startDemo(stage: HTMLElement): void {
  const frames = [
    ...stage.querySelectorAll<HTMLElement>("[data-demo-frame]"),
  ];
  const steps = [...stage.querySelectorAll<HTMLElement>("[data-demo-step]")];
  const list = stage.querySelector<HTMLElement>("[data-demo-steps]");
  const controls = stage.querySelector<HTMLElement>("[data-demo-controls]");
  const live = stage.querySelector<HTMLElement>("[data-demo-live]");
  const previous = stage.querySelector<HTMLButtonElement>(
    "[data-demo-previous]",
  );
  const next = stage.querySelector<HTMLButtonElement>("[data-demo-next]");
  if (
    frames.length === 0 ||
    list === null ||
    controls === null ||
    live === null ||
    previous === null ||
    next === null
  )
    return;
  const nextText = next.textContent ?? "";
  const againText = next.dataset.demoAgain ?? nextText;
  const last = frames.length - 1;
  let current = 0;

  const screenOf = (index: number): HTMLElement | null =>
    frames[index]?.querySelector<HTMLElement>(".xp-screen > .ui-page") ?? null;

  const fit = (smooth: boolean): void => {
    const screen = screenOf(current);
    if (screen === null) return;
    showMustSee(screen, smooth);
    updateFade(screen);
  };

  const show = (index: number): void => {
    current = index;
    frames.forEach((frame, at) =>
      frame.classList.toggle("is-on", at === index),
    );
    steps.forEach((step, at) => {
      if (at === index) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    previous.setAttribute("aria-disabled", index === 0 ? "true" : "false");
    next.textContent = index === last ? againText : nextText;
  };

  const go = (index: number): void => {
    show(index);
    live.textContent = `Step ${index + 1} of ${frames.length}: ${frames[index]?.dataset.demoName ?? ""}`;
    requestAnimationFrame(() => fit(true));
  };

  frames.forEach((_frame, index) => {
    const screen = screenOf(index);
    screen?.addEventListener("scroll", () => updateFade(screen), {
      passive: true,
    });
  });
  previous.addEventListener("click", () => {
    if (current > 0) go(current - 1);
  });
  next.addEventListener("click", () => go(current === last ? 0 : current + 1));

  list.hidden = false;
  controls.hidden = false;
  stage.classList.add("is-live");
  show(0);
  fit(false);
  window.addEventListener("resize", () => fit(false), { passive: true });
  void document.fonts.ready.then(() => fit(false));
}

function showErrors(
  form: HTMLFormElement,
  errors: PartnerApplicationErrors,
): void {
  for (const element of form.querySelectorAll<HTMLElement>(
    "[data-apply-error]",
  )) {
    const field = element.dataset.applyError as keyof PartnerApplicationErrors;
    const text = errors[field];
    element.hidden = text === undefined;
    const slot = element.querySelector("span");
    if (slot) slot.textContent = text ?? "";
    const control = form.querySelector(`[name="${field}"][aria-describedby]`);
    control?.setAttribute("aria-invalid", text === undefined ? "false" : "true");
  }
  const count = Object.keys(errors).length;
  const alert = form.querySelector<HTMLElement>("[data-apply-alert]");
  const line = form.querySelector<HTMLElement>("[data-apply-alert-text]");
  if (alert) alert.hidden = count === 0;
  if (line) line.textContent = count === 0 ? "" : partnerErrorLine(count);
  const first = firstWrongField(errors);
  if (first !== undefined)
    form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
}

function startForm(form: HTMLFormElement): void {
  const send = form.querySelector<HTMLButtonElement>("[data-apply-send]");
  const sendText = send?.textContent ?? "";
  form.addEventListener("submit", (event) => {
    if (send?.getAttribute("aria-busy") === "true") {
      event.preventDefault();
      return;
    }
    const values = new URLSearchParams();
    for (const [name, value] of new FormData(form))
      if (typeof value === "string") values.append(name, value);
    const result = validatePartnerApplication(partnerInputFromForm(values));
    if (!result.ok) {
      event.preventDefault();
      showErrors(form, result.errors);
      return;
    }
    showErrors(form, {});
    if (send) {
      send.setAttribute("aria-busy", "true");
      send.textContent = form.dataset.applySending ?? sendText;
    }
  });
  // Coming back with the browser's Back button must not leave the button busy.
  window.addEventListener("pageshow", () => {
    send?.removeAttribute("aria-busy");
    if (send) send.textContent = sendText;
  });
}

const stage = document.querySelector<HTMLElement>("[data-demo-stage]");
if (stage) startDemo(stage);
const form = document.querySelector<HTMLFormElement>("[data-apply-form]");
if (form) startForm(form);
