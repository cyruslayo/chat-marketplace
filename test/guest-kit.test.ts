import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { icon, type IconName } from "../apps/web/src/ui-kit.js";
import { appBarHtml, bankDetailsHtml, deadlineBannerHtml, priceBreakdownHtml, railHtml, resultRowHtml, stayCardHtml, stayTicketHtml, stepsHtml, statusHtml } from "../apps/local-guest/src/guest-kit.js";
import { projectJourney } from "../apps/local-guest/src/journey-rail.js";

const FOUNDATION_CSS = new URL("../apps/web/src/shortlet-foundations.css", import.meta.url);
const XSS = "<script>alert(1)</script>";
const ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;";

function guestKitCss(css: string): string {
  return css.slice(css.indexOf("/* Guest UI kit (guest-ui-consistency)"), css.indexOf("  .ui-status {"));
}

test("AC1: shortlet-foundations.css defines every guest kit component with tokens only and no hex value", async () => {
  const css = await readFile(FOUNDATION_CSS, "utf8");
  const kit = guestKitCss(css);
  assert.ok(kit.length > 1000, "the guest kit block exists");
  for (const selector of [
    ".ui-appbar", ".ui-appbar__brand", ".ui-icon-button", ".ui-rail", '.ui-rail > li[data-state="done"]', '.ui-rail > li[data-state="current"]', '.ui-rail > li[data-state="failed"]',
    ".ui-chip--add", '.guest-editorial .ui-chip[aria-pressed="true"]', ".ui-fact", ".ui-stay-card", ".ui-stay-card__title", ".ui-result-row", ".ui-tiles", ".ui-tiles__tile",
    ".ui-price-breakdown__row", ".ui-price-breakdown__due", ".ui-price-breakdown__paid", ".ui-price-breakdown__condition", ".ui-steps", ".ui-segmented", ".ui-facts--stacked",
    ".transfer-account", ".transfer-copy", ".ui-upload", ".ui-link", ".ui-action-bar__sum",
  ]) assert.ok(kit.includes(selector), `${selector} is defined`);
  for (const selector of [".ui-ticket__label", ".ui-ticket__name", ".ui-ticket__day", ".ui-ticket__arrow", ".ui-ticket__foot", ".ui-banner--neutral"]) assert.ok(css.includes(selector), `${selector} is defined`);
  assert.doesNotMatch(kit, /#[0-9A-Fa-f]{3,8}\b/, "the kit adds no hex value: colours come from existing tokens");
  const tokens = [...kit.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]!);
  for (const token of new Set(tokens)) assert.match(css.slice(0, css.indexOf("@layer shortlet-foundation")), new RegExp(`${token}:`), `${token} is an existing token`);
  // Existing light values stay authoritative.
  for (const [name, value] of [["--color-surface-inverse", "#063A2C"], ["--color-text-on-inverse-muted", "#D5EBE0"], ["--color-accent-on-inverse", "#5CC49A"], ["--color-action", "#0B5C46"], ["--color-warning-surface", "#FFF2D6"]] as const) {
    assert.match(css, new RegExp(`${name}: ${value};`));
  }
});

function relativeLuminance(hex: string): number {
  const linear = hex.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}
function contrast(first: string, second: string): number {
  const [high, low] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}

test("AC2: every kit text and background pair meets WCAG AA in light and dark", async () => {
  const css = await readFile(FOUNDATION_CSS, "utf8");
  const light = css.slice(0, css.indexOf(":root[data-theme=\"dark\"]"));
  const dark = css.slice(css.indexOf(":root[data-theme=\"dark\"]"), css.indexOf("@media (prefers-color-scheme: dark)"));
  const token = (source: string, name: string): string => {
    const value = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(source)?.[1];
    assert.ok(value, `${name} is defined`);
    return value;
  };
  // [label, foreground, background, minimum ratio]. Text 24px and larger needs 3:1; the rest 4.5:1.
  const pairs: ReadonlyArray<readonly [string, string, string, number]> = [
    ["appbar brand / surface", "--color-text", "--color-surface", 4.5],
    ["rail label muted / surface", "--color-text-muted", "--color-surface", 4.5],
    ["rail label done / surface", "--color-text-secondary", "--color-surface", 4.5],
    ["rail label current / surface", "--color-action", "--color-surface", 4.5],
    ["rail label failed / surface", "--color-danger", "--color-surface", 4.5],
    ["chip pressed", "--color-on-action", "--color-action", 4.5],
    ["chip add / surface", "--color-text-secondary", "--color-surface", 4.5],
    ["fact chip", "--color-text-secondary", "--color-surface-subtle", 4.5],
    ["stay card where / surface", "--color-text-muted", "--color-surface", 4.5],
    ["result row where / surface", "--color-text-muted", "--color-surface", 4.5],
    ["result row chevron / surface", "--color-action", "--color-surface", 3],
    ["ticket label", "--color-text-on-inverse-muted", "--color-surface-inverse", 4.5],
    ["ticket day numeral (24px+)", "--color-text-on-inverse", "--color-surface-inverse", 3],
    ["ticket arrow (24px+ graphic)", "--color-accent-on-inverse", "--color-surface-inverse", 3],
    ["price due row", "--color-text-on-inverse", "--color-surface-inverse", 4.5],
    ["price row / surface", "--color-text-secondary", "--color-surface", 4.5],
    ["price condition tag", "--color-text-secondary", "--color-surface-subtle", 4.5],
    ["banner warning", "--color-warning", "--color-warning-surface", 4.5],
    ["banner success", "--color-success", "--color-success-surface", 4.5],
    ["banner danger", "--color-danger", "--color-danger-surface", 4.5],
    ["banner neutral", "--color-text-secondary", "--color-surface-subtle", 4.5],
    ["status pill neutral", "--color-text-secondary", "--color-surface-subtle", 4.5],
    ["steps numeral", "--color-action", "--color-action-subtle", 4.5],
    ["steps text / surface", "--color-text-secondary", "--color-surface", 4.5],
    ["segmented idle", "--color-text-secondary", "--color-surface-subtle", 4.5],
    ["segmented selected", "--color-text", "--color-surface", 4.5],
    ["stacked fact label / surface", "--color-text-muted", "--color-surface", 4.5],
    ["upload / surface", "--color-text-secondary", "--color-surface", 4.5],
    ["link / surface", "--color-action", "--color-surface", 4.5],
    ["input edge / surface", "--color-border", "--color-surface", 3],
  ];
  for (const [theme, source] of [["light", light], ["dark", dark]] as const) {
    for (const [label, foreground, background, minimum] of pairs) {
      const ratio = contrast(token(source, foreground), token(source, background));
      assert.ok(ratio >= minimum, `${theme} ${label} meets ${minimum}:1 (actual ${ratio.toFixed(2)}:1)`);
    }
  }
});

test("AC3: icon() renders each new icon as a decorative aria-hidden inline SVG", () => {
  const names: readonly IconName[] = ["pin", "bed", "bath", "arrow-left", "arrow-right", "arrow-up", "chevron-right", "copy", "plus", "message-plus", "photo", "bank", "upload", "grid", "doc"];
  for (const name of names) {
    const svg = icon(name);
    assert.match(svg, /^<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">.+<\/svg>$/, name);
    assert.doesNotMatch(svg, /aria-label|<title/, `${name} is decorative`);
  }
});

test("AC4: every guest-kit helper escapes its text fields", () => {
  const preview = { href: `/stays/${XSS}`, title: XSS, neighbourhood: XSS, city: XSS, allInStayTotalKobo: 100_000_00, refundableSecurityDepositKobo: 50_000_00, bedrooms: 1, bathrooms: 1, capacity: 2, nightlyKobo: 1_000_00, nights: 2, photoSrc: `/photos/${XSS}`, unitId: XSS };
  const journey = projectJourney("request", { kind: "declined", label: XSS });
  const outputs: Readonly<Record<string, string>> = {
    ticket: stayTicketHtml({ unitTitle: XSS, checkIn: XSS, checkOut: XSS, nights: 2, guestCount: 2, arrivalTime: XSS, checkoutTime: XSS }),
    breakdown: priceBreakdownHtml({ heading: XSS, allInStayTotalKobo: 100_00, refundableSecurityDepositKobo: 10_00, amountDueNowKobo: 100_00, amountPaidKobo: 100_00 }),
    deadline: deadlineBannerHtml({ label: XSS, deadlineIso: XSS, now: new Date() }),
    steps: stepsHtml([XSS]),
    status: statusHtml("warning", XSS),
    bank: bankDetailsHtml({ bankName: XSS, accountName: XSS, accountNumber: XSS, amountKobo: 100_00, bookingReference: XSS }),
    card: stayCardHtml(preview),
    row: resultRowHtml(preview),
    rail: railHtml(journey),
    appBar: appBarHtml({ backHref: XSS, backLabel: XSS, action: { href: XSS, label: XSS, icon: "plus" } }),
  };
  for (const [name, html] of Object.entries(outputs)) {
    assert.doesNotMatch(html, /<script>/, `${name} leaves no raw script tag`);
    if (name !== "breakdown") assert.ok(html.includes(ESCAPED) || html.includes("&lt;script&gt;"), `${name} shows the escaped text`);
  }
  assert.match(outputs.breakdown!, new RegExp(ESCAPED.replace(/[()]/g, "\\$&")));
});

test("Ticket labels and times: the ticket shows Check-in and Check-out, and times only when the policy projection supplies them (ADR 0031/0032)", () => {
  const facts = { unitTitle: "Lekki Loft", checkIn: "2026-10-03", checkOut: "2026-10-05", nights: 2, guestCount: 2 };
  const plain = stayTicketHtml(facts);
  assert.match(plain, /Check-in/);
  assert.match(plain, /Check-out/);
  assert.match(plain, /Sat, 3 Oct 2026/);
  assert.doesNotMatch(plain, /ui-ticket__time/, "no time is invented");
  assert.match(stayTicketHtml({ ...facts, arrivalTime: "from 2:00 pm", checkoutTime: "by 11:00 am" }), /ui-ticket__time">from 2:00 pm<[\s\S]*ui-ticket__time">by 11:00 am</);
});

test("Breakdown order is total, deposit, amount line (ADR 0015) and a zero deposit is omitted", () => {
  const html = priceBreakdownHtml({ allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 20_000_00, amountDueNowKobo: 390_000_00 });
  assert.ok(html.indexOf("All-In Stay Total") < html.indexOf("Refundable Security Deposit"));
  assert.ok(html.indexOf("Refundable Security Deposit") < html.indexOf("Amount due now"));
  assert.doesNotMatch(priceBreakdownHtml({ allInStayTotalKobo: 100_00, refundableSecurityDepositKobo: 0 }), /Refundable Security Deposit/);
});

test("The deadline banner shows the absolute WAT time and the time left, never negative", () => {
  const html = deadlineBannerHtml({ label: "Pay by", deadlineIso: "2026-10-03T12:30:00.000Z", now: new Date("2026-10-03T12:00:00.000Z") });
  assert.match(html, /Pay by <time datetime="2026-10-03T12:30:00.000Z">1:30 pm WAT, 3 Oct 2026<\/time> · 30 minutes left/i);
  assert.match(deadlineBannerHtml({ label: "Pay by", deadlineIso: "2026-10-03T12:30:00.000Z", now: new Date("2026-10-03T13:00:00.000Z") }), /0 minutes left/);
  assert.match(deadlineBannerHtml({ label: "Pay by", deadlineIso: "2026-10-03T12:59:00.000Z", now: new Date("2026-10-03T12:00:00.000Z") }), /59 minutes left/);
  assert.match(deadlineBannerHtml({ label: "Pay by", deadlineIso: "2026-10-03T12:01:00.000Z", now: new Date("2026-10-03T12:00:00.000Z") }), /1 minute left/);
});

test("Rail markup keeps the journey data-state contract", () => {
  const html = railHtml(projectJourney("pay"));
  assert.match(html, /aria-label="Booking progress"/);
  assert.equal([...html.matchAll(/data-state="done"/g)].length, 4);
  assert.match(html, /data-state="current" aria-current="step"/);
  assert.equal(railHtml(undefined), "");
  assert.match(railHtml(projectJourney("offer", { kind: "expired", label: "Offer expired" })), /data-state="failed"[^>]*>Offer expired/);
});

test("AC6: pill components use --radius-pill, never --radius-round", async () => {
  const css = await readFile(FOUNDATION_CSS, "utf8");
  const kit = guestKitCss(css);
  for (const selector of [".ui-icon-button", ".ui-fact", ".ui-result-row__thumb", ".ui-price-breakdown__condition", ".ui-steps > li::before", ".ui-segmented", ".ui-segmented > label"]) {
    const rule = new RegExp(`${selector.replace(/[.>[\]()]/g, "\$&")} \{[^}]*\}`).exec(kit)?.[0] ?? "";
    assert.ok(rule, `${selector} has a rule`);
  }
  for (const selector of [".ui-icon-button", ".ui-fact", ".ui-price-breakdown__condition", ".ui-segmented"]) {
    const rule = new RegExp(`${selector.replace(/[.>[\]()]/g, "\$&")} \{[^}]*\}`).exec(kit)![0];
    assert.match(rule, /border-radius: var\(--radius-pill\)/, selector);
  }
  assert.doesNotMatch(kit, /var\(--radius-round\)/);
  assert.match(css, /:where\(\.guest-editorial \.ui-chip, \.guest-editorial \.ui-button, \.guest-editorial \.ui-status\) \{ border-radius: var\(--radius-pill\); \}/);
});
