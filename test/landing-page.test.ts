import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import {
  LANDING_COPY,
  LANDING_FORBIDDEN_TERMS,
  LANDING_LENGTH_LIMITS,
  heroHeadingText,
  validateExampleChips,
} from "../apps/local-guest/src/landing-copy.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import {
  GUEST_FORBIDDEN_TERMS,
  guestWaitingCopy,
} from "../apps/web-agent/src/guest-content.js";
import { escapeHtml } from "../apps/web/src/ui-kit.js";
import {
  contrastRatio,
  landingTokenSets,
  stripLandingTokenBlock,
} from "./helpers/landing-tokens.js";

const LANDING_PHOTOS = [
  "ikoyi-living.jpg",
  "ikoyi-bedroom.jpg",
  "lekki-living.jpg",
  "lekki-bedroom.jpg",
];
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

interface ScannedElement {
  readonly tag: string;
  readonly attrs: string;
  /** Open ancestors, outermost first. */
  readonly ancestors: readonly ScannedElement[];
}

/** A small tag scanner: enough structure to check nesting (play containers) without an HTML parser dependency. */
function scanElements(html: string): ScannedElement[] {
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const stack: ScannedElement[] = [];
  const elements: ScannedElement[] = [];
  const pattern =
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const match of source.matchAll(pattern)) {
    const [, closing, rawTag, attrs] = match;
    const tag = rawTag!.toLowerCase();
    if (closing === "/") {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index]!.tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const element: ScannedElement = {
      tag,
      attrs: attrs ?? "",
      ancestors: [...stack],
    };
    elements.push(element);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(attrs ?? "")) stack.push(element);
  }
  return elements;
}

function attr(element: ScannedElement, name: string): string | undefined {
  const match = new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s/>]|$)`).exec(
    element.attrs,
  );
  return match ? (match[1] ?? "") : undefined;
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

async function withLocalServer<T>(
  options: { betaInviteCode?: string },
  run: (base: string) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "landing-page-"));
  const server = startLocalGuestServer({
    port: 0,
    environment: LocalGuestEnvironment.openNode({
      databasePath: join(directory, "guest.sqlite"),
      clock: () => new Date("2026-09-03T10:00:00Z"),
    }),
    ...options,
  });
  try {
    return await run(`http://127.0.0.1:${await server.listen()}`);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("AC1: GET /welcome returns the landing page with no guest session, with a malformed session cookie, and when a beta invite code is configured", async () => {
  await withLocalServer({}, async (base) => {
    const response = await fetch(`${base}/welcome`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const h1 = LANDING_COPY.heroHeading;
    assert.ok(
      (await response.text()).includes(
        `<h1>${escapeHtml(h1.before)}<em class="landing-hero__accent">${escapeHtml(h1.accent)}</em>${escapeHtml(h1.after)}</h1>`,
      ),
      "the approved hero H1 (issue 06 item 3), with its accent word",
    );
  });
  await withLocalServer({}, async (base) => {
    // Failure path: a malformed session cookie is rejected for "/" but never blocks the public page.
    const malformed = await fetch(`${base}/welcome`, {
      headers: { cookie: "shortlet_guest_session=not-a-session" },
    });
    assert.equal(malformed.status, 200);
    const unknown = await fetch(`${base}/welcome`, {
      headers: {
        cookie:
          "shortlet_guest_session=gs-00000000-0000-4000-8000-000000000000",
      },
    });
    assert.equal(
      unknown.status,
      200,
      "a well-formed but unknown session does not block the public page either",
    );
    assert.equal(
      (
        await fetch(`${base}/`, {
          headers: { cookie: "shortlet_guest_session=not-a-session" },
          redirect: "manual",
        })
      ).status,
      401,
    );
  });
  await withLocalServer(
    { betaInviteCode: "beta-test-invite" },
    async (base) => {
      // Failure path: the beta gate guards "/" only; the landing page loads without an invite code.
      const response = await fetch(`${base}/welcome`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<h1>/);
      assert.equal(
        (await fetch(`${base}/`, { redirect: "manual" })).status,
        200,
        "the beta invite screen still gates /",
      );
    },
  );
});

test("AC2: The landing page has one h1, a skip link to main, header, main and footer landmarks, and the same lang as the other guest pages", async () => {
  const html = renderLandingHtml();
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "exactly one h1");
  assert.match(html, /<a class="[^"]*" href="#main">Skip to main content<\/a>/);
  assert.match(html, /<main id="main"/);
  assert.match(html, /<header class="ui-appbar"/);
  assert.match(html, /<footer[\s>]/);
  assert.match(html, /^<!doctype html><html lang="en-NG" data-theme="system">/);
  await withLocalServer({}, async (base) => {
    const guestPage = await (
      await fetch(
        `${base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`,
      )
    ).text();
    assert.match(
      guestPage,
      /<html lang="en-NG"/,
      "the guest pages declare en-NG",
    );
  });
});

test("AC3: Without JavaScript every beat shows its final screen: the message and chips, both priced results, the stay ticket and send button, the reply deadline, and the confirmed Reservation", () => {
  const html = renderLandingHtml();
  const text = visibleText(html);
  // Hero and beat 1: the message and the three criteria chips.
  assert.match(html, /An apartment in Lagos from 10 Sept, 3 nights, 2 of us/);
  for (const chip of ["Lagos", "10–13 Sept", "2 guests"])
    assert.ok(text.includes(chip), `chip ${chip}`);
  // Beat 2 and the hero: both priced results.
  assert.match(
    text,
    /Luxury 2-Bedroom Apartment in Old Ikoyi ₦370,000 All-In Stay Total/,
  );
  assert.match(
    text,
    /Serene 1-Bedroom Suite in Lekki Phase 1 ₦200,000 All-In Stay Total/,
  );
  assert.ok(text.includes("₦20,000"), "Old Ikoyi deposit line");
  assert.ok(text.includes("₦10,000"), "Lekki deposit line");
  // Beat 3: the stay ticket and the send button, not yet sent.
  assert.match(html, /<section class="ui-ticket" aria-label="Your stay">/);
  assert.ok(
    text.includes("Not sent yet") && text.includes("Send Booking Request"),
    "send button in its final state",
  );
  assert.ok(text.includes("We re-check price and availability when you send"));
  // Beat 4: the reply deadline.
  assert.ok(text.includes("Reply due by 10:45 am WAT, 3 Sept 2026"));
  // Beat 5: the confirmed Reservation with the total to complete the booking.
  assert.ok(
    text.includes("Your offer is ready") && text.includes("Payment verified"),
  );
  assert.match(text, /Total to complete booking:? ₦390,000/);
  assert.ok(text.includes("Reservation confirmed"));
  // Failure path: nothing about the final state is only reachable through JavaScript; the script is optional.
  assert.match(html, /<script src="\/landing\.js" defer><\/script>/);
});

test("AC4: Money and booking labels use the guest vocabulary and no forbidden guest terms appear", () => {
  const html = renderLandingHtml();
  const text = visibleText(html);
  assert.ok(
    text.includes("All-In Stay Total"),
    "the All-In Stay Total label is never shortened",
  );
  assert.ok(
    text.includes("Refundable Security Deposit (separate)"),
    "the deposit is named in full",
  );
  assert.ok(
    text.includes("Booking Request sent") && text.includes("Draft created"),
    "receipt labels from GUEST_RECEIPTS",
  );
  assert.doesNotMatch(text, /all-in ·/, "no shortened money label");
  // ADR-0077: beat 4 carries the app's own waiting wording, byte for byte (HTML-escaped).
  const waiting = guestWaitingCopy("operator-response", undefined);
  for (const line of [
    waiting.heading,
    waiting.outcomes[0]!,
    waiting.outcomes[1]!,
    waiting.meanwhile.at(-1)!,
  ]) {
    assert.ok(html.includes(escapeHtml(line)), `beat 4 waiting copy: ${line}`);
  }
  for (const pattern of GUEST_FORBIDDEN_TERMS) {
    assert.doesNotMatch(text, pattern, `forbidden guest term ${pattern}`);
  }
});

test("AC5: Every call to action links to the guest app and no form sends message text in a URL", () => {
  // Issue 04 changes this: the only form is the theme switch, posting to /welcome/theme (never to the guest app).
  const html = renderLandingHtml();
  const elements = scanElements(html);
  const forms = elements.filter((element) => element.tag === "form");
  assert.equal(
    forms.length,
    3,
    "three forms: the theme switch, the hero composer (Issue 08 AC2) and the closing composer (sub-task C)",
  );
  assert.equal(
    attr(forms[0]!, "action"),
    "/welcome/theme",
    "the only form posts the theme choice",
  );
  // Issue 08 AC2: the hero composer is the second form. Issue 14: it POSTs the named `message` field to /welcome/start.
  const composer = forms.find(
    (form) => attr(form, "class") === "landing-composer",
  );
  assert.ok(
    composer &&
      attr(composer, "action") === "/welcome/start" &&
      attr(composer, "method") === "post",
    "the hero composer submits to /welcome/start with POST",
  );
  assert.equal(
    elements.filter((element) => attr(element, "action") !== undefined).length,
    3,
    "the only form actions are the theme switch and the two composers",
  );
  const ctas = elements.filter(
    (element) =>
      element.tag === "a" &&
      /\b(ui-button|landing-composer)\b/.test(attr(element, "class") ?? ""),
  );
  assert.ok(
    ctas.length >= 2,
    "the app bar and beat 5 calls to action (the composers are forms, Issue 08 AC2 and sub-task C)",
  );
  for (const cta of ctas) {
    assert.equal(
      attr(cta, "href"),
      "/",
      "a call to action links to the guest app at /",
    );
  }
  for (const element of elements) {
    const href = attr(element, "href");
    if (href === undefined) continue;
    assert.doesNotMatch(href, /\?/, "no query string carries message text");
    assert.doesNotMatch(href, /apartment|Lagos/i, "no message text in a URL");
  }
});

test("AC6: Landing photos and the landing stylesheet are served publicly, and unknown or traversal photo paths return 404", async () => {
  await withLocalServer({}, async (base) => {
    for (const name of LANDING_PHOTOS) {
      const response = await fetch(`${base}/landing/photos/${name}`);
      assert.equal(response.status, 200, name);
      assert.equal(response.headers.get("content-type"), "image/jpeg", name);
    }
    const css = await fetch(`${base}/shortlet-landing.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    // Failure paths: names outside the allow-list, traversal and encoded traversal are never read from disk.
    for (const path of [
      "unknown.jpg",
      "..%2Fguest-server.ts",
      "..%2F..%2Fpackage.json",
      "ikoyi-living.jpg%2F..%2F..%2Fpackage.json",
      "ikoyi-living.png",
    ]) {
      assert.equal(
        (await fetch(`${base}/landing/photos/${path}`)).status,
        404,
        path,
      );
    }
  });
});

test("AC7: The stage markup follows the contract: every staged element is inside a play container, stage numbers do not exceed the declared count, and transient elements are hidden in the server HTML", () => {
  const elements = scanElements(renderLandingHtml());
  const plays = elements.filter(
    (element) => attr(element, "data-landing-play") !== undefined,
  );
  const expected: Record<string, number> = {
    hero: 4,
    "beat-1": 4,
    "beat-2": 4,
    "beat-3": 4,
    "beat-4": 4,
    "beat-5": 6,
  };
  assert.deepEqual(
    plays.map((element) => [
      attr(element, "data-landing-play"),
      Number(attr(element, "data-landing-stages")),
    ]),
    Object.entries(expected),
  );
  const playAncestor = (element: ScannedElement): ScannedElement | undefined =>
    [...element.ancestors]
      .reverse()
      .find((ancestor) => attr(ancestor, "data-landing-play") !== undefined) ??
    (attr(element, "data-landing-play") !== undefined ? element : undefined);
  const staged = elements.filter(
    (element) =>
      attr(element, "data-landing-stage") !== undefined ||
      attr(element, "data-landing-only") !== undefined,
  );
  assert.ok(staged.length > 0);
  for (const element of staged) {
    const stageValue =
      attr(element, "data-landing-stage") ?? attr(element, "data-landing-only");
    const stage = Number(stageValue);
    assert.ok(
      Number.isInteger(stage) && stage >= 1,
      `stage ${stageValue} is a positive integer`,
    );
    const container = playAncestor(element);
    assert.ok(container, `staged ${element.tag} sits inside a play container`);
    const count = Number(attr(container, "data-landing-stages"));
    assert.ok(
      stage <= count,
      `stage ${stage} does not exceed the ${attr(container, "data-landing-play")} count ${count}`,
    );
  }
  // Failure path: a transient element (shown only during a stage) is hidden in the server HTML.
  const transient = elements.filter(
    (element) => attr(element, "data-landing-only") !== undefined,
  );
  assert.ok(
    transient.length >= 4,
    "the typing dots of the hero and beats 1-2 and the Operator reviewing line of beat 4",
  );
  for (const element of transient) {
    assert.notEqual(
      attr(element, "hidden"),
      undefined,
      `${element.tag} with data-landing-only is hidden`,
    );
  }
  // The captions and screens are addressable in order.
  for (const index of [1, 2, 3, 4, 5]) {
    assert.equal(
      elements.filter(
        (element) => attr(element, "data-landing-caption") === String(index),
      ).length,
      1,
      `caption ${index}`,
    );
    assert.equal(
      elements.filter(
        (element) => attr(element, "data-landing-screen") === String(index),
      ).length,
      1,
      `screen ${index}`,
    );
  }
  const hero = plays.find(
    (element) => attr(element, "data-landing-play") === "hero",
  );
  assert.ok(hero);
  const field = elements.find(
    (element) => attr(element, "data-landing-field") !== undefined,
  );
  assert.ok(
    field && playAncestor(field) === hero,
    "the message box text sits in the hero",
  );
  assert.match(renderLandingHtml(), />Ask about these stays…</);
  const message = elements.find(
    (element) => attr(element, "data-landing-message") !== undefined,
  );
  assert.ok(
    message && attr(message, "data-landing-stage") === "1",
    "the guest bubble is stage 1",
  );
});

test("AC8: The landing stylesheet uses design tokens only and the foundations stylesheet is unchanged", () => {
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  // Issue 07 owner decision: the brand colour literals live only in the marked token block, which AC4 checks.
  assert.doesNotMatch(
    stripLandingTokenBlock(css),
    /#[0-9a-fA-F]{3,8}\b/,
    "no hex literal in the landing stylesheet outside the token block",
  );
  assert.match(css, /var\(--color-/);
  assert.doesNotMatch(
    renderLandingHtml(),
    /style="/,
    "no inline style attributes",
  );
  assert.doesNotMatch(
    renderLandingHtml(),
    /#[0-9a-fA-F]{6}\b/,
    "no hex colour in the markup",
  );
  // Failure path: any edit to the foundations stylesheet other than the Guest UI kit's demo chip fails this check.
  // Issue 04 (ADR 0105) adds one `.ui-chip--demo` line to the kit block; no other line may change.
  const changed = execFileSync(
    "git",
    ["diff", "-U0", "--", "apps/web/src/shortlet-foundations.css"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
  assert.deepEqual(
    changed.filter((line) => !(line.startsWith("+") && /\.ui-chip--demo\b/.test(line))),
    [],
    "the foundations stylesheet changes only by the demo chip line",
  );
});

test("Issue 07 AC4: Every landing token has a light and a dark value, and every text/background token pair meets WCAG AA contrast", () => {
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  const sets = landingTokenSets(css);
  for (const name of Object.keys(sets.light)) {
    assert.notEqual(sets.dark[name], undefined, `${name} has a dark value`);
    assert.notEqual(
      sets.system[name],
      undefined,
      `${name} has a system-dark value`,
    );
  }
  // Failure path: the contrast check reports a failing ratio for known bad pairs.
  assert.ok(
    contrastRatio("#8A6A2F", "#F4EFE6") < 4.5,
    "the original accent-ink on ground is below 4.5:1",
  );
  assert.ok(
    contrastRatio("#999999", "#FFFFFF") < 4.5,
    "#999999 on white is below 4.5:1",
  );
  const pairs: ReadonlyArray<readonly [text: string, background: string]> = [
    ["--landing-ink", "--landing-ground"],
    ["--landing-ink", "--landing-paper"],
    ["--landing-ink-muted", "--landing-ground"],
    ["--landing-ink-muted", "--landing-paper"],
    ["--landing-on-forest", "--landing-forest"],
    ["--landing-on-deep", "--landing-forest-deep"],
    ["--landing-on-deep-muted", "--landing-forest-deep"],
    ["--landing-accent", "--landing-forest-deep"],
    ["--landing-accent-ink", "--landing-ground"],
    ["--landing-accent-ink", "--landing-paper"],
    // Issue 08 sub-task B: the money band cards and the cream card 3 (the same values in every theme).
    ["--landing-band-highlight-ink", "--landing-band-highlight"],
    ["--landing-band-highlight-accent", "--landing-band-highlight"],
    ["--landing-on-deep", "--landing-band-card"],
    ["--landing-on-deep-muted", "--landing-band-card"],
    ["--landing-accent", "--landing-band-card"],
    ["--landing-band-status-ink", "--landing-band-status-surface"],
  ];
  // Non-text graphics (WCAG 1.4.11): the logomark against the grounds it sits on, and the keyhole against the mark.
  const graphics: ReadonlyArray<
    readonly [graphic: string, background: string]
  > = [
    ["--landing-mark", "--landing-ground"],
    ["--landing-mark", "--landing-paper"],
    ["--landing-mark-cut", "--landing-mark"],
  ];
  // Issue 08 sub-task B: the money band tokens do not change between themes (the band stays dark, card 3 stays cream).
  for (const name of Object.keys(sets.light).filter((token) =>
    token.startsWith("--landing-band-"),
  )) {
    assert.equal(
      sets.dark[name],
      sets.light[name],
      `${name} is the same in dark as in light`,
    );
    assert.equal(
      sets.system[name],
      sets.light[name],
      `${name} is the same in system-dark as in light`,
    );
  }
  for (const [theme, set] of Object.entries(sets)) {
    for (const [text, background] of pairs) {
      const ratio = contrastRatio(set[text]!, set[background]!);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${text} on ${background} is ${ratio.toFixed(2)}:1, below 4.5:1`,
      );
    }
    for (const [graphic, background] of graphics) {
      const ratio = contrastRatio(set[graphic]!, set[background]!);
      assert.ok(
        ratio >= 3,
        `${theme}: ${graphic} on ${background} is ${ratio.toFixed(2)}:1, below 3:1`,
      );
    }
  }
});

test("AC9: The example booking is labelled as an example and the unapproved answers stay visible placeholders", () => {
  const html = renderLandingHtml("system", { placeholders: true });
  const text = visibleText(html);
  assert.ok(
    text.includes(escapeHtml(LANDING_COPY.howEyebrow)),
    "the approved section eyebrow (copy deck S07)",
  );
  assert.ok(text.includes("Example booking · real app screens"));
  // Issue 08 AC6 (sub-task C): the bracketed answers show only with placeholders on; the public page omits them.
  assert.ok(text.includes("[AREAS WITH PUBLISHED INVENTORY]"));
  assert.ok(text.includes("[APPROVED FEE ANSWER]"));
  assert.doesNotMatch(
    visibleText(renderLandingHtml()),
    /AREAS WITH PUBLISHED INVENTORY|APPROVED FEE ANSWER/,
  );
  // Failure path: the placeholders are text, never links or buttons that look approved.
  assert.doesNotMatch(html, /<a[^>]*>\[AREAS WITH PUBLISHED INVENTORY\]/);
  assert.doesNotMatch(html, /<a[^>]*>\[APPROVED FEE ANSWER\]/);
});

// Issue 04: light/dark switch (part A) and the landing typography scale (part B).
const THEME_COOKIE = "shortlet_theme";

async function postTheme(
  base: string,
  body: string,
  cookie?: string,
): Promise<Response> {
  return fetch(`${base}/welcome/theme`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

test("Issue 04 AC1: The landing page offers a Light and Dark choice that is saved and applied before the page paints", async () => {
  const html = renderLandingHtml();
  const elements = scanElements(html);
  const form = elements.find(
    (element) =>
      element.tag === "form" &&
      /\blanding-theme\b/.test(attr(element, "class") ?? ""),
  );
  assert.ok(form, "a theme form");
  assert.equal(attr(form, "method"), "post");
  assert.equal(attr(form, "action"), "/welcome/theme");
  assert.equal(
    attr(form, "aria-label"),
    "Colour theme",
    "the group has an accessible name",
  );
  const buttons = elements.filter(
    (element) => element.tag === "button" && attr(element, "name") === "theme",
  );
  assert.deepEqual(
    buttons.map((button) => attr(button, "value")),
    ["light", "dark"],
  );
  assert.match(visibleText(html), /Light\s+Dark/);
  for (const button of buttons) {
    assert.notEqual(
      attr(button, "aria-pressed"),
      "true",
      "no choice is pressed when no choice is saved",
    );
    assert.equal(attr(button, "type"), "submit");
  }
  assert.match(
    html,
    /<html lang="en-NG" data-theme="system">/,
    "the server default is system",
  );
  await withLocalServer({}, async (base) => {
    const saved = await (
      await fetch(`${base}/welcome`, {
        headers: { cookie: `${THEME_COOKIE}=dark` },
      })
    ).text();
    assert.match(
      saved,
      /<html lang="en-NG" data-theme="dark">/,
      "the saved theme is in the first HTML the browser paints",
    );
    const pressed = scanElements(saved).filter(
      (element) =>
        element.tag === "button" && attr(element, "aria-pressed") === "true",
    );
    assert.deepEqual(
      pressed.map((button) => attr(button, "value")),
      ["dark"],
      "the saved choice is marked",
    );
    const light = await (
      await fetch(`${base}/welcome`, {
        headers: { cookie: `${THEME_COOKIE}=light` },
      })
    ).text();
    assert.match(light, /<html lang="en-NG" data-theme="light">/);
    const saving = await postTheme(base, "theme=dark");
    assert.equal(saving.status, 303);
    assert.equal(saving.headers.get("location"), "/welcome");
    assert.equal(
      saving.headers.get("set-cookie"),
      `${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });
});

test("Issue 04 AC2: An invalid theme value is rejected with 400 and leaves the saved theme unchanged", async () => {
  await withLocalServer({}, async (base) => {
    for (const body of [
      "theme=blue",
      "theme=",
      "theme=system",
      "theme=light&theme=dark",
      "theme=DARK",
      "other=dark",
      "",
    ]) {
      const response = await postTheme(base, body, `${THEME_COOKIE}=light`);
      assert.equal(response.status, 400, body);
      assert.equal(
        response.headers.get("set-cookie"),
        null,
        `${JSON.stringify(body)} sets no cookie`,
      );
    }
    // Failure path: a page request with the saved choice still renders that choice after the rejected posts.
    const page = await (
      await fetch(`${base}/welcome`, {
        headers: { cookie: `${THEME_COOKIE}=light` },
      })
    ).text();
    assert.match(page, /<html lang="en-NG" data-theme="light">/);
    // Failure path: an invalid cookie value on the page is treated as no saved choice, never as an error.
    for (const value of ["neon", "dark%20", "%22dark%22", "DARK"]) {
      const invalid = await fetch(`${base}/welcome`, {
        headers: { cookie: `${THEME_COOKIE}=${value}` },
      });
      assert.equal(invalid.status, 200);
      assert.match(
        await invalid.text(),
        /<html lang="en-NG" data-theme="system">/,
        value,
      );
    }
  });
});

test("Issue 04 AC3: Without JavaScript the theme choice still works through the form", async () => {
  // The form is plain HTML: a method, an action and two named submit buttons.
  const elements = scanElements(renderLandingHtml());
  const form = elements.find(
    (element) =>
      element.tag === "form" &&
      /\blanding-theme\b/.test(attr(element, "class") ?? ""),
  );
  assert.ok(form);
  assert.equal(attr(form, "method"), "post");
  await withLocalServer({}, async (base) => {
    // A browser without JavaScript submits the form body; the server saves the choice and redirects back to /welcome.
    const response = await postTheme(
      base,
      "theme=light",
      "shortlet_guest_session=not-a-session",
    );
    assert.equal(
      response.status,
      303,
      "the stale guest session cookie does not block the theme POST",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(
      cookie,
      /^shortlet_theme=light; Path=\/; Max-Age=31536000; SameSite=Lax$/,
    );
    const reloaded = await (
      await fetch(`${base}/welcome`, {
        headers: { cookie: cookie.split(";")[0]! },
      })
    ).text();
    assert.match(
      reloaded,
      /<html lang="en-NG" data-theme="light">/,
      "the redirected page shows the saved theme",
    );
    // Failure path: a GET never saves a theme.
    const wrongMethod = await fetch(`${base}/welcome/theme?theme=dark`, {
      redirect: "manual",
    });
    assert.notEqual(wrongMethod.status, 303, "a GET never saves a theme");
    assert.equal(wrongMethod.headers.get("set-cookie"), null);
  });
});

test("Issue 04 AC4: With JavaScript the theme changes immediately without reloading the page", () => {
  // Behaviour is verified in a real browser (test/landing-page-chromium.test.ts, Issue 04 AC4). Here the script must
  // hook the theme buttons, call preventDefault and save with a POST to /welcome/theme.
  const script = readFileSync(
    new URL("../apps/local-guest/src/landing-page.ts", import.meta.url),
    "utf8",
  );
  assert.match(script, /\/welcome\/theme/);
  assert.match(script, /preventDefault\(\)/);
  assert.match(script, /aria-pressed/);
  assert.match(script, /dataset\.theme\s*=|setAttribute\(["']data-theme["']/);
});

test("Issue 04 AC5: Headings step down in size from the hero to section to beat headings at both phone and desktop widths", () => {
  // Computed sizes are checked in test/landing-page-chromium.test.ts (Issue 04 AC5). Here, the three heading tokens exist.
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  for (const token of [
    "--landing-size-h1",
    "--landing-size-h2",
    "--landing-size-h3",
  ]) {
    assert.match(
      css,
      new RegExp(`${token}:\\s*clamp\\(`),
      `${token} is defined in the landing stylesheet`,
    );
  }
});

test("Issue 04 AC6: Heading and body sizes grow between phone and desktop widths and keep growing at 200% zoom", () => {
  // Growth is measured in Chromium (Issue 04 AC6). Here, every scaled size is a clamp() from rem to rem plus vw.
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  const tokens = [
    ...css.matchAll(
      /(--landing-size-[a-z0-9-]+):\s*clamp\(\s*([\d.]+)rem,\s*([\d.-]+)rem\s*\+\s*([\d.]+)vw,\s*([\d.]+)rem\s*\)/g,
    ),
  ];
  assert.ok(
    tokens.length >= 7,
    `at least seven scaled roles, found ${tokens.length}`,
  );
  for (const [, name, min, , slope, max] of tokens) {
    assert.ok(Number(max) > Number(min), `${name} grows`);
    assert.ok(Number(slope) > 0, `${name} uses a vw term so it keeps growing`);
  }
  assert.doesNotMatch(
    css,
    /--landing-size-[a-z0-9-]+:\s*[\d.]+px/,
    "no px-only size token",
  );
  assert.doesNotMatch(
    css,
    /--landing-size-[a-z0-9-]+:\s*[\d.]+vw\s*;/,
    "no vw-only size token",
  );
});

test("Issue 04 AC7: Prose lines stay at or under 75 characters and headings use the display face", () => {
  // Line lengths and computed faces are measured in Chromium (Issue 04 AC7). Here, the measure limits are in the CSS.
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  for (const limit of ["46ch", "60ch", "18ch", "22ch"])
    assert.match(css, new RegExp(`max-inline-size:\\s*${limit}`), limit);
  assert.match(
    css,
    /\.landing-hero h1[\s\S]*?font-family:\s*var\(--font-display\)/,
  );
  assert.match(
    css,
    /\.landing-section__intro h2[\s\S]*?font-family:\s*var\(--font-display\)/,
  );
});

test("Issue 04 AC8: Text inside the phone screens matches the app sizes and the rail labels never break mid-word", () => {
  // Measured in Chromium (Issue 04 AC8). Here, the phone sizes are the app's own fixed sizes in the stylesheet.
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.landing-bot,\s*\.landing-me\s*\{[^}]*font-size:\s*0\.9375rem/,
    "bubbles are 15px",
  );
  assert.match(
    css,
    /\.landing-chip\s*\{[^}]*font-size:\s*0\.875rem/,
    "chips are 14px",
  );
  assert.match(
    css,
    /\.landing-phone \.ui-rail > li\s*\{[^}]*overflow-wrap:\s*normal/,
    "rail labels never break mid-word",
  );
});

test("Issue 04 AC9: No text on the landing page is smaller than 12 pixels in either theme", () => {
  // Measured per rendered text node in Chromium (Issue 04 AC9). Here, every font size in the stylesheet is at least 12px.
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  for (const match of css.matchAll(/font-size:\s*([\d.]+)rem/g)) {
    assert.ok(
      Number(match[1]) >= 0.75,
      `font-size ${match[1]}rem is at least 12px`,
    );
  }
  for (const match of css.matchAll(/font-size:\s*(\d+)px/g)) {
    assert.ok(
      Number(match[1]) >= 12,
      `font-size ${match[1]}px is at least 12px`,
    );
  }
});

// Issue 05: the approved copy deck (apps/local-guest/src/landing-copy.ts) and the "Nothing due yet" status tags.

/** Text of every `.landing-phone` element in document order (tags stripped, whitespace collapsed). */
function phoneTexts(html: string): string[] {
  const texts: string[] = [];
  // Issue 08 AC3: the example chat window replaces the hero phone, so it is read as the first screen.
  for (const match of html.matchAll(
    /<div class="(?:landing-phone|landing-chat)"/g,
  )) {
    let depth = 0;
    let end = -1;
    for (const inner of html
      .slice(match.index)
      .matchAll(/<(\/?)div\b[^>]*>/g)) {
      depth += inner[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = match.index! + inner.index! + inner[0].length;
        break;
      }
    }
    texts.push(
      html
        .slice(match.index, end)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return texts;
}

const PHONE_TEXT_SNAPSHOT = JSON.parse(
  readFileSync(
    new URL("./fixtures/landing-phone-text.json", import.meta.url),
    "utf8",
  ),
) as string[];

test("Issue 05 AC1: Every marketing slot on the landing page shows the approved deck copy", () => {
  const html = renderLandingHtml();
  const text = visibleText(html);
  const single: readonly string[] = [
    LANDING_COPY.heroEyebrow,
    heroHeadingText(),
    LANDING_COPY.heroLede,
    LANDING_COPY.howEyebrow,
    LANDING_COPY.howHeading,
    LANDING_COPY.exampleLabel,
    LANDING_COPY.faqHeading,
    LANDING_COPY.closingHeading,
    ...LANDING_COPY.pain,
    ...LANDING_COPY.headings,
    ...LANDING_COPY.bodies,
    ...LANDING_COPY.faq
      .filter((item) => !item.placeholder)
      .flatMap((item) => [item.question, item.answer]),
  ];
  for (const slot of single) {
    assert.ok(text.includes(escapeHtml(slot)), `approved copy shown: ${slot}`);
  }
  // S04 (composer placeholder) and S06 (reassurance) in the hero and the closing; S05 (button) in the app bar, the hero,
  // beat 5 and the closing.
  // S04: the hero field's placeholder (Issue 08 AC2 form) and the closing composer's field text.
  assert.equal(
    html.split(`placeholder="${escapeHtml(LANDING_COPY.composerPlaceholder)}"`)
      .length - 1,
    2,
    "S04 as the hero and the closing field placeholder (sub-task C)",
  );
  assert.equal(
    html.split('class="landing-composer__field"').length - 1,
    0,
    "the old closing link composer is gone",
  );
  assert.equal(
    html.split(
      `<p class="ui-field__hint">${escapeHtml(LANDING_COPY.reassurance)}</p>`,
    ).length - 1,
    2,
    "S06 under the hero and the closing",
  );
  assert.equal(
    html.split(`>${escapeHtml(LANDING_COPY.primaryAction)}</`).length - 1,
    3,
    "S05 in the hero composer, beat 5 and closing (the app bar now says Start a conversation)",
  );
  // S12: the browser tab title.
  assert.ok(
    html.includes(`<title>${escapeHtml(LANDING_COPY.pageTitle)}</title>`),
    "S12 browser tab title",
  );
  // Failure path: the replaced copy is gone.
  for (const old of [
    "Good to know",
    "Where are you headed?",
    "Start your search",
    "Starting a search doesn’t reserve or charge anything.",
    "Where, when and how many of you?",
  ]) {
    assert.ok(!text.includes(old), `old copy removed: ${old}`);
  }
});

test("Issue 05 AC2: The FAQ explains that dates are held while the Operator replies and become yours only after confirmation and verified payment", () => {
  const html = renderLandingHtml();
  const first = LANDING_COPY.faq[0]!;
  assert.ok(
    html.includes(
      `<details class="landing-faq__item" open><summary>${escapeHtml(first.question)}</summary><p>${escapeHtml(first.answer)}</p></details>`,
    ),
    "Q1 with its approved answer, open (sub-task C: native details)",
  );
  assert.match(first.answer, /held for you while the Operator replies/);
  assert.match(first.answer, /up to 30 minutes in their active hours/);
  assert.match(
    first.answer,
    /yours once the Operator confirms and your payment is verified\.$/,
  );
  assert.doesNotMatch(
    first.answer,
    /^No\./,
    "the old answer that read as contradicting the hold is gone",
  );
  // Failure path: the placeholder answers are left out of the public page (Issue 08 AC6) and show only with placeholders on.
  assert.ok(
    !html.includes("[AREAS WITH PUBLISHED INVENTORY]") &&
      !html.includes("[APPROVED FEE ANSWER]"),
    "placeholder answers are hidden by default",
  );
  const shown = renderLandingHtml("system", { placeholders: true });
  assert.ok(
    shown.includes("[AREAS WITH PUBLISHED INVENTORY]") &&
      shown.includes("[APPROVED FEE ANSWER]"),
  );
  for (const item of LANDING_COPY.faq
    .slice(1)
    .filter((entry) => !entry.placeholder))
    assert.ok(html.includes(escapeHtml(item.answer)), item.question);
});

test("Issue 05 AC3: The status tags sit in the money timeline, not under the steps: the first two cards say nothing is due yet and the third says what is due now", () => {
  // Changed by Issue 08 sub-task B: the per-beat tags (addition 1) move to the money timeline (approved 14 Oct 2026).
  const html = renderLandingHtml();
  assert.equal(
    html.split('class="landing-status"').length - 1,
    0,
    "no status tag under any step caption",
  );
  const money = sectionAt(html, '<section id="money"');
  const tags = [
    ...money.matchAll(
      /<span class="ui-status ui-status--(\w+)">([^<]*)<\/span>/g,
    ),
  ].map((match) => [match[1], match[2]]);
  assert.deepEqual(tags, [
    ["neutral", LANDING_COPY.statusNothingDue],
    ["neutral", LANDING_COPY.statusNothingDue],
    ["warning", LANDING_COPY.statusDueNow],
  ]);
});

test("Issue 05 AC4: The copy inside the phone screens is unchanged", () => {
  const texts = phoneTexts(renderLandingHtml());
  assert.equal(texts.length, 6, "the hero and the five beat phones");
  assert.deepEqual(
    texts,
    PHONE_TEXT_SNAPSHOT,
    "the phone text matches the snapshot taken before issue 05",
  );
});

test("Issue 05 AC5: No landing copy uses a forbidden term or an exclamation mark, and every slot stays within its deck length limit", () => {
  const html = renderLandingHtml();
  const landingStrings: string[] = [
    LANDING_COPY.heroEyebrow,
    heroHeadingText(),
    LANDING_COPY.heroLede,
    LANDING_COPY.composerPlaceholder,
    LANDING_COPY.primaryAction,
    LANDING_COPY.reassurance,
    LANDING_COPY.howEyebrow,
    LANDING_COPY.howHeading,
    LANDING_COPY.exampleLabel,
    LANDING_COPY.faqHeading,
    LANDING_COPY.closingHeading,
    LANDING_COPY.pageTitle,
    LANDING_COPY.statusNothingDue,
    LANDING_COPY.statusDueNow,
    ...LANDING_COPY.faq.flatMap((item) => [item.question, item.answer]),
    ...LANDING_COPY.pain,
    ...LANDING_COPY.headings,
    ...LANDING_COPY.bodies,
  ];
  for (const term of LANDING_FORBIDDEN_TERMS) {
    for (const copy of landingStrings)
      assert.doesNotMatch(copy, term, `forbidden term ${term} in: ${copy}`);
  }
  assert.doesNotMatch(
    visibleText(html),
    /!/,
    "no exclamation mark on the page",
  );
  for (const copy of landingStrings) {
    assert.doesNotMatch(copy, /['"]/, `typographic quotes only: ${copy}`);
  }
  // Each slot within its limit from the copy brief (see LANDING_LENGTH_LIMITS).
  const within = (value: string, limit: number, name: string): void =>
    assert.ok(
      value.length <= limit,
      `${name} is ${value.length} characters, limit ${limit}`,
    );
  within(LANDING_COPY.heroEyebrow, LANDING_LENGTH_LIMITS.heroEyebrow, "S01");
  within(heroHeadingText(), LANDING_LENGTH_LIMITS.heroHeading, "S02");
  within(LANDING_COPY.heroLede, LANDING_LENGTH_LIMITS.heroLede, "S03");
  within(
    LANDING_COPY.composerPlaceholder,
    LANDING_LENGTH_LIMITS.composerPlaceholder,
    "S04",
  );
  within(
    LANDING_COPY.primaryAction,
    LANDING_LENGTH_LIMITS.primaryAction,
    "S05",
  );
  within(LANDING_COPY.reassurance, LANDING_LENGTH_LIMITS.reassurance, "S06");
  within(LANDING_COPY.howEyebrow, LANDING_LENGTH_LIMITS.howEyebrow, "S07");
  within(LANDING_COPY.howHeading, LANDING_LENGTH_LIMITS.howHeading, "S08");
  LANDING_COPY.pain.forEach((pain, index) =>
    within(pain, LANDING_LENGTH_LIMITS.pain, `P${index + 1}`),
  );
  LANDING_COPY.headings.forEach((heading, index) =>
    within(heading, LANDING_LENGTH_LIMITS.heading, `H${index + 1}`),
  );
  LANDING_COPY.bodies.forEach((body, index) =>
    within(body, LANDING_LENGTH_LIMITS.body, `B${index + 1}`),
  );
  within(LANDING_COPY.exampleLabel, LANDING_LENGTH_LIMITS.exampleLabel, "S09");
  within(LANDING_COPY.faqHeading, LANDING_LENGTH_LIMITS.faqHeading, "S10");
  LANDING_COPY.faq.forEach((item, index) =>
    within(item.question, LANDING_LENGTH_LIMITS.faqQuestion, `Q${index + 1}`),
  );
  within(
    LANDING_COPY.closingHeading,
    LANDING_LENGTH_LIMITS.closingHeading,
    "S11",
  );
  within(LANDING_COPY.pageTitle, LANDING_LENGTH_LIMITS.pageTitle, "S12");
  within(
    LANDING_COPY.statusNothingDue,
    LANDING_LENGTH_LIMITS.statusNothingDue,
    "status 1-4",
  );
  within(
    LANDING_COPY.statusDueNow,
    LANDING_LENGTH_LIMITS.statusDueNow,
    "status 5",
  );
  // Issue 08 slots (issue 06 items 3 and 6): the same forbidden-term, quote and length rules cover every new string.
  const newSlots: {
    readonly copy: string;
    readonly limit: number;
    readonly name: string;
  }[] = [
    {
      copy: LANDING_COPY.composerLabel,
      limit: LANDING_LENGTH_LIMITS.composerLabel,
      name: "composer label",
    },
    {
      copy: LANDING_COPY.appBarAction,
      limit: LANDING_LENGTH_LIMITS.appBarAction,
      name: "app bar action",
    },
    {
      copy: LANDING_COPY.appBarActionShort,
      limit: LANDING_LENGTH_LIMITS.appBarActionShort,
      name: "app bar short action",
    },
    {
      copy: LANDING_COPY.navHowItWorks,
      limit: LANDING_LENGTH_LIMITS.navLabel,
      name: "nav how",
    },
    {
      copy: LANDING_COPY.navYourMoney,
      limit: LANDING_LENGTH_LIMITS.navLabel,
      name: "nav money",
    },
    {
      copy: LANDING_COPY.navQuestions,
      limit: LANDING_LENGTH_LIMITS.navLabel,
      name: "nav questions",
    },
    ...LANDING_COPY.exampleChips.map((chip) => ({
      copy: chip.text,
      limit: LANDING_LENGTH_LIMITS.exampleChip,
      name: `chip ${chip.text}`,
    })),
    ...LANDING_COPY.trust.flatMap((item) => [
      {
        copy: item.title,
        limit: LANDING_LENGTH_LIMITS.trustTitle,
        name: `trust title ${item.title}`,
      },
      {
        copy: item.line,
        limit: LANDING_LENGTH_LIMITS.trustLine,
        name: `trust line ${item.title}`,
      },
    ]),
    {
      copy: `${LANDING_COPY.apartmentsHeading.before}${LANDING_COPY.apartmentsHeading.accent}`,
      limit: LANDING_LENGTH_LIMITS.apartmentsHeading,
      name: "apartments heading",
    },
    {
      copy: LANDING_COPY.apartmentsLine,
      limit: LANDING_LENGTH_LIMITS.apartmentsLine,
      name: "apartments line",
    },
    {
      copy: `${LANDING_COPY.moneyHeading.before}${LANDING_COPY.moneyHeading.accent}`,
      limit: LANDING_LENGTH_LIMITS.moneyHeading,
      name: "money heading",
    },
    ...LANDING_COPY.moneyCards.flatMap((card) => [
      {
        copy: card.title,
        limit: LANDING_LENGTH_LIMITS.moneyCardTitle,
        name: `money card ${card.number} title`,
      },
      {
        copy: card.body,
        limit: LANDING_LENGTH_LIMITS.moneyCardBody,
        name: `money card ${card.number} body`,
      },
      {
        copy: card.status,
        limit: LANDING_LENGTH_LIMITS.moneyCardStatus,
        name: `money card ${card.number} status`,
      },
    ]),
  ];
  for (const slot of newSlots) {
    within(slot.copy, slot.limit, slot.name);
    for (const term of LANDING_FORBIDDEN_TERMS)
      assert.doesNotMatch(
        slot.copy,
        term,
        `forbidden term ${term} in ${slot.name}`,
      );
    assert.doesNotMatch(
      slot.copy,
      /['"]/,
      `typographic quotes only in ${slot.name}`,
    );
  }
});

test('Issue 07 AC1: The landing page shows the logomark beside the wordmark, and the logo link is named "Shortlet"', () => {
  const html = renderLandingHtml();
  const markPattern =
    /<svg class="landing-mark" [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>/;
  // The app-bar brand link keeps its href and class, holds the mark immediately before the wordmark text, and nothing else.
  const header =
    /<a class="ui-appbar__brand" href="\/welcome">([\s\S]*?)<\/a>/.exec(html);
  assert.ok(header, "the app-bar brand link is present");
  assert.match(
    header[1]!,
    new RegExp(`^${markPattern.source}Shortlet$`),
    "the mark sits immediately before the wordmark",
  );
  // The accessible name is the link's text without the aria-hidden SVG.
  assert.equal(
    header[1]!
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
    "Shortlet",
  );
  // The footer brand carries the same mark.
  const footer = /<span class="ui-appbar__brand">([\s\S]*?)<\/span>/.exec(html);
  assert.ok(footer, "the footer brand is present");
  assert.match(
    footer[1]!,
    new RegExp(`^${markPattern.source}Shortlet$`),
    "the footer mark sits before the footer wordmark",
  );
  // Failure path: the phone mockup title bars stay plain wordmarks (app layer), and only the header and footer carry the mark.
  const bars =
    html.match(/<div class="landing-phone__bar">[\s\S]*?<\/div>/g) ?? [];
  assert.ok(bars.length > 0, "phone title bars are present");
  for (const bar of bars)
    assert.doesNotMatch(
      bar,
      /landing-mark/,
      "phone title bars carry no logomark",
    );
  assert.equal(
    html.match(/class="landing-mark"/g)?.length,
    2,
    "exactly two logomarks: header and footer",
  );
});

test("Issue 07 AC5: Total font payload on first load is at most 160 KB, and text paints before the fonts arrive", async () => {
  const fontDirectory = new URL(
    "../apps/local-guest/assets/fonts/",
    import.meta.url,
  );
  const files = readdirSync(fontDirectory)
    .filter((name) => name.endsWith(".woff2"))
    .sort();
  assert.deepEqual(
    files,
    [
      "hanken-grotesk-400-700.woff2",
      "newsreader-500.woff2",
      "newsreader-italic-400.woff2",
    ],
    "the three approved WOFF2 files",
  );
  const bytes = files.reduce(
    (sum, name) => sum + statSync(new URL(name, fontDirectory)).size,
    0,
  );
  assert.ok(
    bytes <= 160 * 1024,
    `${bytes} bytes of WOFF2 on first load, at most ${160 * 1024}`,
  );
  // Text paints with the fallback stack first: every face swaps in, none blocks rendering.
  const css = readFileSync(
    new URL("../apps/web/src/shortlet-landing.css", import.meta.url),
    "utf8",
  );
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  assert.equal(faces.length, 3, "one @font-face per shipped file");
  for (const face of faces) assert.match(face, /font-display:\s*swap;/, face);
  // The hero H1 weight is the only preloaded font.
  assert.ok(
    renderLandingHtml().includes(
      `<link rel="preload" as="font" type="font/woff2" crossorigin href="/landing/fonts/newsreader-500.woff2">`,
    ),
    "the H1 weight is preloaded",
  );
  await withLocalServer({}, async (base) => {
    for (const name of files) {
      const response = await fetch(`${base}/landing/fonts/${name}`);
      assert.equal(response.status, 200, name);
      assert.equal(response.headers.get("content-type"), "font/woff2", name);
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
        name,
      );
    }
    // Failure paths: unknown names, other formats and traversal are never read from disk.
    for (const path of [
      "unknown.woff2",
      "newsreader-500.ttf",
      "newsreader-700.woff2",
      "..%2Fguest-server.ts",
      "newsreader-500.woff2%2F..%2F..%2Fpackage.json",
    ]) {
      assert.equal(
        (await fetch(`${base}/landing/fonts/${path}`)).status,
        404,
        path,
      );
    }
  });
});

// Issue 08 (sub-task A): the hero composer, the example chat window and the example chips.

function heroSection(html: string): string {
  const start = html.indexOf('<section class="landing-hero"');
  assert.ok(start >= 0, "the hero section is rendered");
  return html.slice(
    start,
    html.indexOf("</section>", start) + "</section>".length,
  );
}

test("Issue 08 AC2: The hero composer is a labelled text field with a submit button, and submitting it never places the typed text in the URL", () => {
  const html = renderLandingHtml();
  const hero = heroSection(html);
  const form = /<form class="landing-composer"[^>]*>[\s\S]*?<\/form>/.exec(
    hero,
  )?.[0];
  assert.ok(
    form,
    "the hero composer is a <form>, not an <a> styled as an input",
  );
  assert.doesNotMatch(
    hero,
    /<a class="landing-composer"/,
    "the hero composer is no longer a link",
  );
  assert.match(
    form,
    /^<form class="landing-composer" action="\/welcome\/start" method="post">/,
    "issue 14: the form POSTs the message in the body, never a GET query string",
  );
  const labelFor =
    /<label(?: class="[^"]*")? for="([^"]+)">Describe your stay<\/label>/.exec(
      form,
    )?.[1];
  assert.ok(
    labelFor,
    "a visible label reads Describe your stay and points at the field",
  );
  const input = /<input\b[^>]*>/.exec(form)?.[0];
  assert.ok(input, "the composer has an input");
  assert.match(
    input,
    new RegExp(`\\bid="${labelFor}"`),
    "the label's for matches the input id",
  );
  assert.match(input, /\btype="text"/, "the field is a text input");
  assert.ok(
    input.includes(
      `placeholder="${escapeHtml(LANDING_COPY.composerPlaceholder)}"`,
    ),
    "the placeholder is the approved hint",
  );
  // Failure path: the field is named for the POST body only; the form is never a GET form, so the text cannot reach a URL.
  assert.match(input, /\bname="message"/, "the text field is the named message field");
  assert.doesNotMatch(form, /method="get"/i, "no GET form carries the text");
  assert.doesNotMatch(form, /type="hidden"/, "no hidden field carries text");
  const submit = /<button\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/.exec(
    form,
  );
  assert.ok(submit, "the composer has a submit button");
  assert.ok(
    submit[1]!.includes(LANDING_COPY.primaryAction),
    "the submit button says See what you can book",
  );
});

test("Issue 08 AC3: The example conversation sits in one chat window that carries the hero stage contract, and no other hero phone is rendered", () => {
  const html = renderLandingHtml();
  const elements = scanElements(html);
  const windows = elements.filter(
    (element) =>
      attr(element, "role") === "group" &&
      attr(element, "aria-label") === "An example booking conversation",
  );
  assert.equal(windows.length, 1, "exactly one example conversation region");
  const chat = windows[0]!;
  assert.equal(
    attr(chat, "data-landing-play"),
    "hero",
    "the chat window is the hero play container",
  );
  assert.equal(
    attr(chat, "data-landing-stages"),
    "4",
    "and declares the four hero stages",
  );
  const inside = elements.filter((element) => element.ancestors.includes(chat));
  const stages = new Set(
    inside
      .map((element) => attr(element, "data-landing-stage"))
      .filter((value) => value !== undefined),
  );
  assert.deepEqual(
    [...stages].sort(),
    ["1", "2", "4"],
    "stages 1, 2 and 4 are inside the window",
  );
  assert.ok(
    inside.some((element) => attr(element, "data-landing-only") === "3"),
    "the typing slot (stage 3) is inside the window",
  );
  const message = inside.find(
    (element) => attr(element, "data-landing-message") !== undefined,
  );
  assert.ok(
    message && attr(message, "data-landing-stage") === "1",
    "the guest message is stage 1 inside the window",
  );
  assert.ok(
    inside.some((element) => attr(element, "data-landing-field") !== undefined),
    "the window's message box is inside the window",
  );
  // Failure path: no other hero phone, and no hero stage markup outside the window.
  assert.equal(
    elements.filter((element) => attr(element, "data-landing-play") === "hero")
      .length,
    1,
    "one hero play container",
  );
  const beforeBeats = html.slice(0, html.indexOf('id="how"'));
  assert.doesNotMatch(
    beforeBeats,
    /class="landing-phone"/,
    "no phone frame before the How it works section",
  );
  // The example label sits directly under the chat window (direction doc, row 3). Issue 08 sub-task B adds a second label
  // under the How it works heading (AC4 checks it); both regions are example screens.
  const windowEnd = html.indexOf(
    "</div></div>",
    html.indexOf('role="group" aria-label="An example booking conversation"'),
  );
  assert.ok(
    html.indexOf("Example booking · real app screens") > windowEnd,
    "the label is under the chat window",
  );
});

test("Issue 08 AC8: Every example chip describes a stay of 1–14 nights", () => {
  const html = renderLandingHtml();
  assert.equal(LANDING_COPY.exampleChips.length, 3, "three example chips");
  assert.deepEqual(
    validateExampleChips(LANDING_COPY.exampleChips),
    [],
    "every chip has between 1 and 14 nights (ADR-0023)",
  );
  for (const chip of LANDING_COPY.exampleChips) {
    assert.ok(
      html.includes(`>${escapeHtml(chip.text)}</button>`),
      `the chip is rendered as a button: ${chip.text}`,
    );
  }
  // Failure path: the same validator rejects a 15-night chip, a zero-night chip and a fractional one.
  assert.equal(
    validateExampleChips([{ text: "Ikoyi, 15 nights", nights: 15 }]).length,
    1,
    "15 nights is rejected",
  );
  assert.equal(
    validateExampleChips([{ text: "Ikoyi, no nights", nights: 0 }]).length,
    1,
    "0 nights is rejected",
  );
  assert.equal(
    validateExampleChips([{ text: "Ikoyi, half a night", nights: 1.5 }]).length,
    1,
    "a fractional night is rejected",
  );
});

// Issue 08 sub-task B: how it works (the five steps) and the money timeline.
function sectionAt(html: string, marker: string): string {
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `the section ${marker} is rendered`);
  return html.slice(
    start,
    html.indexOf("</section>", start) + "</section>".length,
  );
}

test("Issue 08 AC4: Each of the five steps shows its approved heading, body and pain line, and no pain line is struck through or marked with a warning icon", () => {
  const html = renderLandingHtml();
  const how = html.slice(
    html.indexOf('<section id="how"'),
    html.indexOf('<section id="money"'),
  );
  assert.ok(
    how.includes('<ol class="landing-steps">'),
    "the steps are an ordered list",
  );
  assert.equal(
    how.split('data-beat="').length - 1,
    5,
    "five steps, each an item of the list",
  );
  assert.ok(
    how.includes(
      `<p class="ui-field__hint landing-example">${escapeHtml(LANDING_COPY.exampleLabel)}</p>`,
    ),
    "How it works carries the example label under its heading",
  );
  for (let index = 0; index < 5; index++) {
    const start = how.indexOf(`data-landing-caption="${index + 1}"`);
    const end = how.indexOf('class="landing-beat__screen"', start);
    const caption = how.slice(start, end);
    assert.ok(
      caption.includes(`<h3>${escapeHtml(LANDING_COPY.headings[index]!)}</h3>`),
      `step ${index + 1} heading`,
    );
    assert.ok(
      caption.includes(
        `<p class="landing-caption__body">${escapeHtml(LANDING_COPY.bodies[index]!)}</p>`,
      ),
      `step ${index + 1} body`,
    );
    assert.ok(
      caption.includes(
        `<p class="landing-pain">Instead of ${escapeHtml(LANDING_COPY.pain[index]!)}</p>`,
      ),
      `step ${index + 1} pain line as plain text`,
    );
  }
  // Failure path: no struck-through text and no icon inside any pain line.
  assert.doesNotMatch(how, /<s[\s>]/, "no <s> element in the steps");
  const pains = [
    ...how.matchAll(/<p class="landing-pain">([\s\S]*?)<\/p>/g),
  ].map((match) => match[1]!);
  assert.equal(pains.length, 5, "five pain lines");
  for (const pain of pains)
    assert.doesNotMatch(
      pain,
      /<svg|<s[\s>]/,
      "a pain line has no icon and no strike-through",
    );
});

test('Issue 08 AC5: "Nothing due yet" and "Due now" appear only in the money timeline, each as text', () => {
  const html = renderLandingHtml();
  const money = sectionAt(html, '<section id="money"');
  const outside = html.replace(money, "");
  assert.equal(
    outside.split("Nothing due yet").length - 1,
    0,
    "no Nothing due yet outside the money timeline",
  );
  assert.equal(
    outside.split("Due now").length - 1,
    0,
    "no Due now outside the money timeline",
  );
  assert.equal(
    money.split(
      `<span class="ui-status ui-status--neutral">Nothing due yet</span>`,
    ).length - 1,
    2,
    "cards 1 and 2 say Nothing due yet, as text",
  );
  assert.equal(
    money.split(
      `<span class="ui-status ui-status--warning">${escapeHtml(LANDING_COPY.statusDueNow)}</span>`,
    ).length - 1,
    1,
    "card 3 says Due now, as text",
  );
  // Failure path: the tags are not carried by the step captions or the phones.
  assert.equal(
    html.split('class="landing-status"').length - 1,
    0,
    "no landing-status wrapper remains",
  );
});

// Issue 08 sub-task C: apartments, questions, closing, footer, the placeholder switch and the shared content edge.

/** Visible text with every tag removed and no space added: a heading split by its italic accent reads as one string. */
function flatText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
}

test("Issue 08 AC1: The page renders the ten sections in the order of the direction doc, each with its approved copy from landing-copy.ts", () => {
  const html = renderLandingHtml("system", { placeholders: true });
  const order = [
    '<header class="ui-appbar"',
    '<section class="landing-hero"',
    'landing-chat-wrap"',
    '<section class="landing-trust"',
    '<section id="apartments"',
    '<section id="how"',
    '<section id="money"',
    '<section id="questions"',
    '<section class="landing-closing',
    '<footer class="landing-footer"',
  ];
  let previous = -1;
  for (const marker of order) {
    const at = html.indexOf(marker);
    assert.ok(
      at > previous,
      `${marker} is present, after the section before it`,
    );
    previous = at;
  }
  const text = flatText(html);
  const approved: string[] = [
    LANDING_COPY.heroEyebrow,
    heroHeadingText(),
    LANDING_COPY.heroLede,
    LANDING_COPY.composerLabel,
    LANDING_COPY.reassurance,
    ...LANDING_COPY.trust.flatMap((item) => [item.title, item.line]),
    `${LANDING_COPY.apartmentsHeading.before}${LANDING_COPY.apartmentsHeading.accent}`,
    LANDING_COPY.apartmentsLine,
    LANDING_COPY.howEyebrow,
    LANDING_COPY.howHeading,
    ...LANDING_COPY.headings,
    ...LANDING_COPY.bodies,
    ...LANDING_COPY.pain.map((pain) => `Instead of ${pain}`),
    `${LANDING_COPY.moneyHeading.before}${LANDING_COPY.moneyHeading.accent}`,
    ...LANDING_COPY.moneyCards.flatMap((card) => [
      card.title,
      card.body,
      card.status,
    ]),
    LANDING_COPY.faqHeading,
    ...LANDING_COPY.faq.flatMap((item) => [item.question, item.answer]),
    LANDING_COPY.closingHeading,
    LANDING_COPY.navHowItWorks,
    LANDING_COPY.navYourMoney,
    LANDING_COPY.navQuestions,
    LANDING_COPY.appBarAction,
  ];
  for (const copy of approved)
    assert.ok(text.includes(copy), `approved copy on the page: ${copy}`);
  for (const chip of LANDING_COPY.exampleChips)
    assert.ok(text.includes(chip.text), `example chip: ${chip.text}`);
  // Failure path: with the default (public-safe) render, no approved unit is on the page, so the apartments section is omitted.
  const publicPage = renderLandingHtml();
  assert.ok(
    !publicPage.includes('<section id="apartments"'),
    "the apartments section is omitted when no entry is approved",
  );
  assert.ok(
    publicPage.includes('<section id="how"'),
    "the rest of the page still renders",
  );
});

test("Issue 08 AC6: No bracketed placeholder text appears on the page when placeholders are disabled", () => {
  const html = renderLandingHtml();
  const text = visibleText(html);
  assert.doesNotMatch(
    text,
    /\[[^\]]*\]/,
    "no bracketed text in the visible page",
  );
  assert.doesNotMatch(
    html,
    /ABUJA PHOTO|\[Area\]|\[bedrooms\]/,
    "no placeholder card label",
  );
  assert.doesNotMatch(html, /landing-unit--placeholder/, "no placeholder card");
  assert.doesNotMatch(
    html,
    /<h2[^>]*>Help<\/h2>|>Help</,
    "no Help column without configured help links",
  );
  assert.doesNotMatch(
    text,
    /Support|Privacy|Terms/,
    "no support, privacy or terms link without configured links",
  );
  // Failure path: placeholders on show the bracketed FAQ answers and the Abuja card.
  const shown = renderLandingHtml("system", { placeholders: true });
  const shownText = visibleText(shown);
  assert.ok(
    shownText.includes("[AREAS WITH PUBLISHED INVENTORY]"),
    "the bracketed FAQ answer shows with placeholders on",
  );
  assert.ok(
    shownText.includes("[APPROVED FEE ANSWER]"),
    "the second bracketed FAQ answer shows with placeholders on",
  );
  assert.ok(
    shownText.includes("[ABUJA PHOTO · APPROVED UNIT]"),
    "the Abuja placeholder card label shows with placeholders on",
  );
  assert.ok(
    shownText.includes("[Area] · [bedrooms]"),
    "the Abuja placeholder card detail shows with placeholders on",
  );
  // Follow-up: the hero and closing photographs are unapproved too, so neither section renders an image on the public page.
  // (The app-layer phone and chat photos are a separate question, raised in the report.)
  assert.doesNotMatch(
    heroSection(html),
    /<img/,
    "the hero has no photograph on the public page and still paints its solid ground",
  );
  assert.doesNotMatch(
    sectionAt(html, '<section class="landing-closing"'),
    /<img/,
    "the closing has no photograph on the public page",
  );
  assert.match(
    heroSection(shown),
    /<img class="landing-hero__photo" src="\/landing\/photos\/ikoyi-living\.jpg"/,
    "the hero photograph shows with placeholders on",
  );
  assert.match(
    sectionAt(shown, '<section class="landing-closing"'),
    /<img class="landing-closing__photo" src="\/landing\/photos\/ikoyi-bedroom\.jpg"/,
    "the closing photograph shows with placeholders on",
  );
});
