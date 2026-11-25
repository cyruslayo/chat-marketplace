"use strict";
(() => {
  // packages/platform-core/src/accounts/contact.ts
  var EMAIL_MAX_LENGTH = 254;
  function normalizeContactEmail(input) {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Email address is required");
    if (trimmed.length > EMAIL_MAX_LENGTH)
      throw new Error("Email address is too long");
    const at = trimmed.lastIndexOf("@");
    if (at <= 0 || at !== trimmed.indexOf("@"))
      throw new Error("Enter a valid email address");
    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1).toLowerCase();
    if (local.length > 64 || !/^[^\s@]+$/.test(local) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(domain) || domain.includes(".."))
      throw new Error("Enter a valid email address");
    return `${local}@${domain}`.toLowerCase();
  }

  // apps/local-guest/src/partner-application.ts
  var PARTNER_AREAS = [
    "Wuse",
    "Maitama",
    "Asokoro",
    "Garki",
    "Gwarinpa",
    "Jabi",
    "Other"
  ];
  var PARTNER_UNIT_RANGES = ["1", "2 to 5", "6 to 20", "20+"];
  var PARTNER_STAY_LENGTHS = ["short", "monthly"];
  var PARTNER_TEXT_MAX = Object.freeze({
    fullName: 200,
    business: 200,
    phone: 32,
    email: 254,
    how: 2e3
  });
  var PARTNER_FIELDS = [
    "fullName",
    "business",
    "phone",
    "email",
    "area",
    "units",
    "stays",
    "consent"
  ];
  var EMPTY_PARTNER_INPUT = Object.freeze({
    fullName: "",
    business: "",
    phone: "",
    email: "",
    area: "",
    units: "",
    stays: Object.freeze([]),
    how: "",
    consent: false
  });
  var PARTNER_ERROR_TEXT = Object.freeze({
    fullName: "Your full name is missing, so we don\u2019t know who to ask for. Enter the name we should use.",
    business: "Your business name is missing, so we can\u2019t review the application. Enter the name of your business.",
    phone: "This phone number looks incomplete, so we can\u2019t call you. Enter it with the country code, like +234 801 234 5678.",
    email: "This email address isn\u2019t complete, so we can\u2019t write to you. Enter it in the form name@example.com.",
    area: "No area is chosen, so we can\u2019t plan the inspection. Choose the area where your apartments are.",
    units: "The number of apartments is missing, so we can\u2019t plan the visit. Choose the range that fits.",
    stays: "No stay length is ticked, so we don\u2019t know which guests to bring you. Tick at least one.",
    consent: "We need your permission to contact you, or we can\u2019t reply to this application. Tick the box to agree."
  });
  function partnerErrorLine(count) {
    return count === 1 ? "1 answer needs fixing, so your application wasn\u2019t sent. Check the field marked below, then send again." : `${count} answers need fixing, so your application wasn\u2019t sent. Check the fields marked below, then send again.`;
  }
  function partnerInputFromForm(form2) {
    const one = (name) => {
      const values = form2.getAll(name);
      return values.length === 1 ? values[0].trim() : "";
    };
    return {
      fullName: one("fullName"),
      business: one("business"),
      phone: one("phone"),
      email: one("email"),
      area: one("area"),
      units: one("units"),
      stays: form2.getAll("stays"),
      how: one("how"),
      consent: one("consent") === "yes"
    };
  }
  function member(list, value) {
    return list.find((entry) => entry === value);
  }
  function filled(value, max) {
    return value !== "" && value.length <= max;
  }
  function phoneIsComplete(value) {
    if (!filled(value, PARTNER_TEXT_MAX.phone) || !/^[+\d\s().-]+$/.test(value))
      return false;
    const digits = value.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 15;
  }
  function emailOf(value) {
    try {
      return normalizeContactEmail(value);
    } catch {
      return void 0;
    }
  }
  function validatePartnerApplication(input) {
    const area = member(PARTNER_AREAS, input.area);
    const units = member(PARTNER_UNIT_RANGES, input.units);
    const stays = PARTNER_STAY_LENGTHS.filter(
      (length) => input.stays.includes(length)
    );
    const email = emailOf(input.email);
    const wrong = {
      fullName: !filled(input.fullName, PARTNER_TEXT_MAX.fullName),
      business: !filled(input.business, PARTNER_TEXT_MAX.business),
      phone: !phoneIsComplete(input.phone),
      email: email === void 0,
      area: area === void 0,
      units: units === void 0,
      stays: stays.length === 0 || input.stays.some(
        (value) => member(PARTNER_STAY_LENGTHS, value) === void 0
      ),
      consent: !input.consent
    };
    const fields = PARTNER_FIELDS.filter((field) => wrong[field]);
    if (fields.length > 0 || email === void 0 || area === void 0 || units === void 0) {
      return {
        ok: false,
        errors: Object.fromEntries(
          fields.map((field) => [field, PARTNER_ERROR_TEXT[field]])
        )
      };
    }
    return {
      ok: true,
      application: {
        fullName: input.fullName,
        business: input.business,
        phone: input.phone,
        email,
        area,
        units,
        stays,
        how: input.how
      }
    };
  }
  function firstWrongField(errors) {
    return PARTNER_FIELDS.find((field) => errors[field] !== void 0);
  }

  // apps/local-guest/src/partners-page.ts
  var FADE_PX = 24;
  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function showMustSee(screen, smooth) {
    const bar = screen.querySelector("[data-demo-bar]");
    const barHeight = bar !== null && getComputedStyle(bar).position === "sticky" ? bar.offsetHeight : 0;
    const focal = screen.querySelector("[data-demo-focal]");
    if (focal === null) {
      screen.scrollTop = 0;
      return;
    }
    const mustSee = [
      focal,
      ...screen.querySelectorAll("[data-demo-keep]")
    ];
    const top = screen.getBoundingClientRect().top - screen.scrollTop;
    const lowest = Math.max(
      ...mustSee.map((item) => item.getBoundingClientRect().bottom - top)
    );
    const highest = focal.getBoundingClientRect().top - top;
    const view = screen.clientHeight - barHeight - FADE_PX;
    const target = Math.min(Math.max(0, lowest - view), highest);
    screen.scrollTo({
      top: target,
      behavior: smooth && !reducedMotion() ? "smooth" : "instant"
    });
  }
  function updateFade(screen) {
    const fade = screen.parentElement?.querySelector(
      ".xp-screen__fade"
    );
    if (!fade) return;
    const more = screen.scrollHeight - screen.clientHeight - screen.scrollTop > FADE_PX;
    fade.classList.toggle("is-on", more);
    const bar = screen.querySelector("[data-demo-bar]");
    const sticky = bar !== null && getComputedStyle(bar).position === "sticky";
    fade.style.bottom = sticky ? `${bar.offsetHeight}px` : "0px";
  }
  function startDemo(stage2) {
    const frames = [
      ...stage2.querySelectorAll("[data-demo-frame]")
    ];
    const steps = [...stage2.querySelectorAll("[data-demo-step]")];
    const list = stage2.querySelector("[data-demo-steps]");
    const controls = stage2.querySelector("[data-demo-controls]");
    const live = stage2.querySelector("[data-demo-live]");
    const previous = stage2.querySelector(
      "[data-demo-previous]"
    );
    const next = stage2.querySelector("[data-demo-next]");
    if (frames.length === 0 || list === null || controls === null || live === null || previous === null || next === null)
      return;
    const nextText = next.textContent ?? "";
    const againText = next.dataset.demoAgain ?? nextText;
    const last = frames.length - 1;
    let current = 0;
    const screenOf = (index) => frames[index]?.querySelector(".xp-screen > .ui-page") ?? null;
    const fit = (smooth) => {
      const screen = screenOf(current);
      if (screen === null) return;
      showMustSee(screen, smooth);
      updateFade(screen);
    };
    const show = (index) => {
      current = index;
      frames.forEach(
        (frame, at) => frame.classList.toggle("is-on", at === index)
      );
      steps.forEach((step, at) => {
        if (at === index) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      });
      previous.setAttribute("aria-disabled", index === 0 ? "true" : "false");
      next.textContent = index === last ? againText : nextText;
    };
    const go = (index) => {
      show(index);
      live.textContent = `Step ${index + 1} of ${frames.length}: ${frames[index]?.dataset.demoName ?? ""}`;
      requestAnimationFrame(() => fit(true));
    };
    frames.forEach((_frame, index) => {
      const screen = screenOf(index);
      screen?.addEventListener("scroll", () => updateFade(screen), {
        passive: true
      });
    });
    previous.addEventListener("click", () => {
      if (current > 0) go(current - 1);
    });
    next.addEventListener("click", () => go(current === last ? 0 : current + 1));
    list.hidden = false;
    controls.hidden = false;
    stage2.classList.add("is-live");
    show(0);
    fit(false);
    window.addEventListener("resize", () => fit(false), { passive: true });
    void document.fonts.ready.then(() => fit(false));
  }
  function showErrors(form2, errors) {
    for (const element of form2.querySelectorAll(
      "[data-apply-error]"
    )) {
      const field = element.dataset.applyError;
      const text = errors[field];
      element.hidden = text === void 0;
      const slot = element.querySelector("span");
      if (slot) slot.textContent = text ?? "";
      const control = form2.querySelector(`[name="${field}"][aria-describedby]`);
      control?.setAttribute("aria-invalid", text === void 0 ? "false" : "true");
    }
    const count = Object.keys(errors).length;
    const alert = form2.querySelector("[data-apply-alert]");
    const line = form2.querySelector("[data-apply-alert-text]");
    if (alert) alert.hidden = count === 0;
    if (line) line.textContent = count === 0 ? "" : partnerErrorLine(count);
    const first = firstWrongField(errors);
    if (first !== void 0)
      form2.querySelector(`[name="${first}"]`)?.focus();
  }
  function startForm(form2) {
    const send = form2.querySelector("[data-apply-send]");
    const sendText = send?.textContent ?? "";
    form2.addEventListener("submit", (event) => {
      if (send?.getAttribute("aria-busy") === "true") {
        event.preventDefault();
        return;
      }
      const values = new URLSearchParams();
      for (const [name, value] of new FormData(form2))
        if (typeof value === "string") values.append(name, value);
      const result = validatePartnerApplication(partnerInputFromForm(values));
      if (!result.ok) {
        event.preventDefault();
        showErrors(form2, result.errors);
        return;
      }
      showErrors(form2, {});
      if (send) {
        send.setAttribute("aria-busy", "true");
        send.textContent = form2.dataset.applySending ?? sendText;
      }
    });
    window.addEventListener("pageshow", () => {
      send?.removeAttribute("aria-busy");
      if (send) send.textContent = sendText;
    });
  }
  var stage = document.querySelector("[data-demo-stage]");
  if (stage) startDemo(stage);
  var form = document.querySelector("[data-apply-form]");
  if (form) startForm(form);
})();
