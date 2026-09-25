import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment, startLocalOwnerServer } from "../apps/local-owner/src/index.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";

const FOUNDATION_CSS_URL = new URL("../apps/web/src/shortlet-foundations.css", import.meta.url);

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255);
  assert.equal(channels?.length, 3);
  const linear = channels!.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(first: string, second: string): number {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

function token(css: string, name: string): string {
  const value = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1];
  assert.ok(value, `CSS token ${name} exists`);
  return value;
}

test("Shortlet foundation tokens use the approved semantic palette and pass specified contrast checks", async () => {
  const css = await readFile(FOUNDATION_CSS_URL, "utf8");
  const expected: Readonly<Record<string, string>> = {
    "--color-canvas": "#F6F5F0",
    "--color-surface": "#FFFFFF",
    "--color-surface-subtle": "#EEECE5",
    "--color-surface-elevated": "#FFFFFF",
    "--color-text": "#1D2923",
    "--color-text-secondary": "#49574E",
    "--color-text-muted": "#5D6A62",
    "--color-border": "#747C75",
    "--color-action": "#0B5C46",
    "--color-action-hover": "#084735",
    "--color-action-pressed": "#063A2C",
    "--color-focus": "#995300",
    "--color-success": "#176B49",
    "--color-success-surface": "#EAF4EE",
    "--color-warning": "#7A4C00",
    "--color-warning-surface": "#FFF2D6",
    "--color-danger": "#A12B2B",
    "--color-danger-surface": "#FCECEC",
    "--color-info": "#185F83",
    "--color-info-surface": "#EAF3F8",
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(token(css, name).toUpperCase(), value);
  assert.match(css, /system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif/);
  assert.doesNotMatch(css, /@import\s+url\s*\(/i);

  const canvas = token(css, "--color-canvas");
  const white = token(css, "--color-surface");
  const checks: ReadonlyArray<readonly [string, string, string, number]> = [
    ["primary text / canvas", token(css, "--color-text"), canvas, 4.5],
    ["secondary text / canvas", token(css, "--color-text-secondary"), canvas, 4.5],
    ["muted text / canvas", token(css, "--color-text-muted"), canvas, 4.5],
    ["primary button / action", white, token(css, "--color-action"), 4.5],
    ["focus / canvas", token(css, "--color-focus"), canvas, 3],
    ["focus / white", token(css, "--color-focus"), white, 3],
    ["success status", token(css, "--color-success"), token(css, "--color-success-surface"), 4.5],
    ["warning status", token(css, "--color-warning"), token(css, "--color-warning-surface"), 4.5],
    ["danger status", token(css, "--color-danger"), token(css, "--color-danger-surface"), 4.5],
    ["info status", token(css, "--color-info"), token(css, "--color-info-surface"), 4.5],
    ["border / canvas", token(css, "--color-border"), canvas, 3],
  ];
  for (const [label, foreground, background, minimum] of checks) {
    assert.ok(contrastRatio(foreground, background) >= minimum, `${label} meets ${minimum}:1 (actual ${contrastRatio(foreground, background).toFixed(2)}:1)`);
  }
});

test("Guest and Operator conventional surfaces load the shared stylesheet", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-foundation-http-"));
  const guestEnvironment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const ownerEnvironment = new LocalApartmentOwnerEnvironment({ databasePath: join(directory, "owner.sqlite") });
  const guestServer = startLocalGuestServer({ port: 0, environment: guestEnvironment, conciergeMode: "deterministic" });
  const ownerServer = startLocalOwnerServer({ port: 0, environment: ownerEnvironment });
  const guestPort = await guestServer.listen();
  const ownerPort = await ownerServer.listen();
  t.after(async () => {
    await guestServer.close();
    await ownerServer.close();
    await rm(directory, { recursive: true, force: true });
  });

  const guestHome = await fetch(`http://127.0.0.1:${guestPort}/`).then((response) => response.text());
  assert.match(guestHome, /href="\/shortlet-foundations\.css"/);
  const guestCss = await fetch(`http://127.0.0.1:${guestPort}/shortlet-foundations.css`);
  assert.equal(guestCss.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await guestCss.text(), /--color-canvas:\s*#F6F5F0/);

  const operatorLogin = await fetch(`http://127.0.0.1:${ownerPort}/operator/login`).then((response) => response.text());
  assert.match(operatorLogin, /href="\/shortlet-foundations\.css"/);
  assert.match(operatorLogin, /class="ui-button ui-button--primary[^"]*" type="submit">Sign in/);
  const operatorCss = await fetch(`http://127.0.0.1:${ownerPort}/shortlet-foundations.css`);
  assert.equal(operatorCss.headers.get("content-type"), "text/css; charset=utf-8");
});

test("Real Chromium renders foundation without narrow viewport overflow and exposes visible keyboard focus", {
  skip: process.env.SHORTLET_FOUNDATIONS_BROWSER !== "1" ? "Run explicitly with SHORTLET_FOUNDATIONS_BROWSER=1 to avoid competing with the full Chromium suite" : false,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-foundation-browser-"));
  const guestEnvironment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const ownerEnvironment = new LocalApartmentOwnerEnvironment({ databasePath: join(directory, "owner.sqlite") });
  ownerEnvironment.createDemoIncomingBookingRequest();
  const guestServer = startLocalGuestServer({ port: 0, environment: guestEnvironment, conciergeMode: "deterministic" });
  const ownerServer = startLocalOwnerServer({ port: 0, environment: ownerEnvironment });
  const guestPort = await guestServer.listen();
  const ownerPort = await ownerServer.listen();
  const browser = await launchRealBrowser();
  const evidenceDirectory = join(process.cwd(), ".scratch", "ui-foundations");
  await mkdir(evidenceDirectory, { recursive: true });
  t.after(async () => {
    await browser.close();
    await guestServer.close();
    await ownerServer.close();
    await rm(directory, { recursive: true, force: true });
  });

  const guest = await browser.createTab(`http://127.0.0.1:${guestPort}/`);
  await guest.waitForFunction("getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim() !== ''");
  const targetSizes = await guest.evaluate<{ button: number; composer: number; composerInput: number }>(
    "(() => { const button = document.createElement('button'); button.className = 'ui-button ui-button--primary'; button.textContent = 'Continue'; document.body.append(button); const result = {button: button.getBoundingClientRect().height, composer: document.querySelector('#composer-submit').getBoundingClientRect().height, composerInput: document.querySelector('#composer-input').getBoundingClientRect().height}; button.remove(); return result; })()",
  );
  assert.ok(targetSizes.button >= 44, `shared button target is at least 44px: ${JSON.stringify(targetSizes)}`);
  assert.ok(targetSizes.composer >= 44 && targetSizes.composerInput >= 48, `Guest composer targets meet approved minimums: ${JSON.stringify(targetSizes)}`);
  const viewportWidths = [320, 390, 768, 1280] as const;
  for (const width of viewportWidths) {
    await guest.setCssViewport(width, 900);
    const metrics = await guest.evaluate<{ innerWidth: number; clientWidth: number; scrollWidth: number; gutter: string; h1: string; display: string }>(
      "({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, gutter: getComputedStyle(document.documentElement).getPropertyValue('--layout-gutter-mobile').trim(), h1: getComputedStyle(document.documentElement).getPropertyValue('--font-size-h1').trim(), display: getComputedStyle(document.documentElement).getPropertyValue('--font-size-display').trim()})",
    );
    assert.equal(metrics.innerWidth, width, `CSS viewport is ${width}px`);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, `Guest has no horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`);
    const expectedGutter = width === 320 ? "1rem" : width === 390 ? "1.125rem" : width === 768 ? "1.5rem" : "2rem";
    assert.equal(metrics.gutter, expectedGutter, `approved layout gutter at ${width}px`);
    const mobileTypeScale = width < 768;
    assert.equal(metrics.h1, mobileTypeScale ? "1.75rem" : "2rem", `approved H1 size at ${width}px`);
    assert.equal(metrics.display, mobileTypeScale ? "2rem" : "2.5rem", `approved display size at ${width}px`);
    await writeFile(join(evidenceDirectory, `guest-home-${width}.png`), await guest.captureScreenshot());
  }
  const focusGuest = await browser.createTab(`http://127.0.0.1:${guestPort}/`);
  await focusGuest.waitForFunction("getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim() !== ''");
  await focusGuest.pressKey("Tab");
  const focus = await focusGuest.evaluate<{ visible: boolean; outlineStyle: string; outlineWidth: string; outlineColor: string }>(
    "(() => { const node = document.activeElement; const style = node ? getComputedStyle(node) : null; return {visible: Boolean(node?.matches(':focus-visible')), outlineStyle: style?.outlineStyle ?? '', outlineWidth: style?.outlineWidth ?? '', outlineColor: style?.outlineColor ?? ''}; })()",
  );
  assert.equal(focus.visible, true);
  assert.equal(focus.outlineStyle, "solid", JSON.stringify(focus));
  assert.equal(focus.outlineWidth, "3px");
  assert.equal(focus.outlineColor, "rgb(153, 83, 0)");
  await writeFile(join(evidenceDirectory, "focus-visible.png"), await focusGuest.captureScreenshot());

  await guest.setCssViewport(390, 900);
  await guest.evaluate("(() => { const input = document.querySelector('#composer-input'); if (!input) throw new Error('composer missing'); input.value = 'I need an apartment in Ikoyi for 3 nights for 2 people'; document.querySelector('#composer').requestSubmit(); })()");
  await guest.waitForText("eligible Unit found");
  await writeFile(join(evidenceDirectory, "guest-weaver-390.png"), await guest.captureScreenshot());

  const operator = await browser.createTab(`http://127.0.0.1:${ownerPort}/operator/login`);
  await writeFile(join(evidenceDirectory, "operator-login.png"), await operator.captureScreenshot());
  const accessToken = ownerEnvironment.provisionOperatorAccessToken();
  await operator.evaluate(`(() => { const field = document.querySelector('#token'); field.value = ${JSON.stringify(accessToken)}; document.querySelector('form').requestSubmit(); })()`);
  await operator.waitForText("Operator workspace");
  await operator.navigate(`http://127.0.0.1:${ownerPort}/operator/requests`);
  await operator.waitForText("Booking Requests");
  const operatorTargets = await operator.evaluate<{ logout: number; font: string }>(
    "(() => { const button = document.querySelector('button'); return {logout: button.getBoundingClientRect().height, font: getComputedStyle(button).fontFamily}; })()",
  );
  assert.ok(operatorTargets.logout >= 44, `Operator action target is at least 44px: ${JSON.stringify(operatorTargets)}`);
  assert.match(operatorTargets.font, /system-ui/);
  for (const width of viewportWidths) {
    await operator.setCssViewport(width, 900);
    const metrics = await operator.evaluate<{ innerWidth: number; clientWidth: number; scrollWidth: number }>(
      "({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})",
    );
    assert.equal(metrics.innerWidth, width, `Operator CSS viewport is ${width}px`);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, `Operator inbox has no horizontal overflow at ${width}px`);
    await writeFile(join(evidenceDirectory, `operator-inbox-${width}.png`), await operator.captureScreenshot());
  }
});
