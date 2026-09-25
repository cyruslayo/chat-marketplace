import assert from "node:assert/strict";
import { readdir, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { errorPage, formatMoney, pageShell, prefersHtml } from "../apps/web/src/ui-kit.js";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { GUEST_STATUS_HEADLINES, guestStatusTone } from "../apps/local-guest/src/conversational-shell.js";
import { renderGuestShellHtml, startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

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

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block exists`);
  return css.slice(start, css.indexOf("}", start));
}

function tokenIn(source: string, name: string): string {
  const value = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(source)?.[1];
  assert.ok(value, `token ${name} is defined`);
  return value;
}

test("Dark roles keep text at 4.5:1 and control edges and focus at 3:1", async () => {
  const css = await readFile(FOUNDATION_CSS_URL, "utf8");
  const forced = block(css, ':root[data-theme="dark"]');
  const system = block(css, ':root[data-theme="system"]');
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root\[data-theme="system"\]/);
  for (const dark of [forced, system]) {
    assert.match(dark, /color-scheme: dark/);
    const t = (name: string) => tokenIn(dark, name);
    const checks: ReadonlyArray<readonly [string, string, string, number]> = [
      ["text / canvas", t("--color-text"), t("--color-canvas"), 4.5],
      ["text / surface", t("--color-text"), t("--color-surface"), 4.5],
      ["secondary / canvas", t("--color-text-secondary"), t("--color-canvas"), 4.5],
      ["muted / surface-subtle", t("--color-text-muted"), t("--color-surface-subtle"), 4.5],
      ["on-action / action", t("--color-on-action"), t("--color-action"), 4.5],
      ["action link / surface", t("--color-action"), t("--color-surface"), 4.5],
      ["accent / surface", t("--color-accent"), t("--color-surface"), 4.5],
      ["border / surface", t("--color-border"), t("--color-surface"), 3],
      ["focus / canvas", t("--color-focus"), t("--color-canvas"), 3],
      ["success", t("--color-success"), t("--color-success-surface"), 4.5],
      ["warning", t("--color-warning"), t("--color-warning-surface"), 4.5],
      ["danger", t("--color-danger"), t("--color-danger-surface"), 4.5],
      ["info", t("--color-info"), t("--color-info-surface"), 4.5],
    ];
    for (const [label, foreground, background, minimum] of checks) {
      const ratio = contrastRatio(foreground, background);
      assert.ok(ratio >= minimum, `dark ${label} meets ${minimum}:1 (actual ${ratio.toFixed(2)}:1)`);
    }
  }
  // Every dark role must also exist in the light :root so no colour is dark-only.
  const light = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
  for (const name of forced.match(/--color-[a-z-]+(?=:)/g) ?? []) assert.match(light, new RegExp(`${name}:`), `${name} has a light value`);
});

test("Weaver reads the shared tokens through the --a2ui-* bridge instead of colour overrides", async () => {
  const css = await readFile(FOUNDATION_CSS_URL, "utf8");
  const bridge = block(css, ".weaver-mount");
  for (const [name, value] of [
    ["--a2ui-color-primary", "var(--color-action)"],
    ["--a2ui-color-on-primary", "var(--color-on-action)"],
    ["--a2ui-color-outline", "var(--color-border)"],
    ["--a2ui-color-control", "var(--color-surface-subtle)"],
    ["--a2ui-radius", "var(--radius-control)"],
    ["--a2ui-space", "var(--space-2)"],
  ] as const) assert.match(bridge, new RegExp(`${name}: ${value.replace(/[()]/g, "\\$&")};`));
  const shell = renderGuestShellHtml();
  assert.doesNotMatch(shell, /(background-color|border-color|color): var\(--color-[a-z-]+\) !important/, "no colour is forced over Weaver with !important");
});

test("Migrated Guest and Operator pages take colour only from tokens", async () => {
  const files = [
    "../apps/local-guest/src/guest-server.ts",
    "../apps/local-owner/src/local-owner-server.ts",
    "../apps/web/src/ui-kit.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const hexes = source.match(/(?<![&\w])#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?(?:[0-9A-Fa-f]{2})?\b(?=[;"'\s),}])/g) ?? [];
    assert.deepEqual(hexes, [], `${file} has no hard-coded hex colours`);
  }
});

test("Pages share one shell with en-NG, the foundation stylesheet and opt-in dark mode", () => {
  const html = pageShell({ title: "A & B", body: "<p>x</p>" });
  assert.match(html, /^<!doctype html><html lang="en-NG" data-theme="system">/);
  assert.match(html, /<title>A &amp; B<\/title>/);
  assert.match(html, /href="\/shortlet-foundations\.css"/);
  assert.match(renderGuestShellHtml(), /<html lang="en-NG" data-theme="system">/);
});

test("Money has one display format across Guest and Operator", () => {
  assert.equal(formatMoney(20_200_000), "₦202,000");
  assert.equal(formatMoney(1_845_050), "₦18,450.50");
  assert.equal(formatMoney(0), "₦0");
  assert.equal(formatMoney(-5_000), "-₦50");
  for (const kobo of [0, 1, 99, 100, 12_345_678, -250]) assert.equal(formatNgnKobo(kobo), formatMoney(kobo));
});

test("Booking status headlines map to a tone from an explicit table, not copy heuristics", async () => {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["Request sent · Waiting for Operator response", "info"],
    ["Offer available · Operator confirmed availability", "info"],
    ["Offer accepted · Payment required", "warning"],
    ["Offer accepted. Complete the secure card payment to confirm your booking.", "success"],
    ["Payment required · Refundable Security Deposit", "warning"],
    ["Payment processing · Checking payment", "warning"],
    ["Payment was not verified · Booking not confirmed", "danger"],
    ["Payment requires review · Booking not confirmed", "danger"],
    ["Request declined", "danger"],
    ["Request expired", "warning"],
    ["Offer expired", "warning"],
    ["Booking confirmed", "success"],
    ["Reservation confirmed", "success"],
  ];
  for (const [text, tone] of expected) assert.equal(guestStatusTone(text), tone, text);
  assert.equal(guestStatusTone("Request to Book"), undefined);

  // Guard: every lifecycle headline literal the A2UI builders emit must resolve to a tone.
  const directory = new URL("../apps/web-agent/src/", import.meta.url);
  const lifecycle = /"((?:Request (?:sent|declined|expired)|Offer (?:available|accepted|expired)|Payment (?:required|processing|was not verified|requires review)|Booking confirmed|Reservation confirmed)[^"]*)"/g;
  for (const file of (await readdir(directory)).filter((name) => name.endsWith("-a2ui.ts"))) {
    const source = await readFile(new URL(file, directory), "utf8");
    for (const match of source.matchAll(lifecycle)) assert.ok(guestStatusTone(match[1]!), `${file}: "${match[1]}" is in GUEST_STATUS_HEADLINES`);
  }
  assert.ok(GUEST_STATUS_HEADLINES.length > 0);
});

test("Browser navigations to failed page routes get a styled page; API clients keep JSON", async (t) => {
  assert.equal(prefersHtml("text/html,application/xhtml+xml"), true);
  assert.equal(prefersHtml("*/*"), false);
  const page = errorPage({ status: 404, code: "PAYMENT_OFFER_NOT_FOUND", title: "Missing", message: "Gone <now>", action: { href: "/", label: "Back" } });
  assert.match(page, /data-error-code="PAYMENT_OFFER_NOT_FOUND"/);
  assert.match(page, /Gone &lt;now&gt;/);

  const directory = await mkdtemp(join(tmpdir(), "shortlet-design-system-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const server = startLocalGuestServer({ port: 0, environment, conciergeMode: "deterministic" });
  const port = await server.listen();
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const home = await fetch(`http://127.0.0.1:${port}/`);
  const cookie = home.headers.get("set-cookie")?.split(";")[0] ?? "";
  const html = await fetch(`http://127.0.0.1:${port}/payments/offers/unknown-offer`, { headers: { accept: "text/html", cookie } });
  assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await html.text();
  assert.ok(html.status === 404 || html.status === 401, `status ${html.status}`);
  assert.match(body, /class="ui-panel ui-empty"/);
  assert.match(body, /Back to your conversation/);

  const json = await fetch(`http://127.0.0.1:${port}/payments/offers/unknown-offer`, { headers: { cookie } });
  assert.match(json.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(((await json.json()) as { ok: boolean }).ok, false);
});
