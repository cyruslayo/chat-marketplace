import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pageShell } from "../apps/web/src/ui-kit.js";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";

// Issue 25 (ADR 0078; guideline §7 16px inputs, §12): the guest pages resize for the on-screen keyboard and the composer
// grows with its content where supported.

test("AC1: The viewport meta includes interactive-widget=resizes-content on guest pages", () => {
  assert.match(renderGuestShellHtml(), /<meta name="viewport" content="[^"]*interactive-widget=resizes-content/);
  assert.match(pageShell({ title: "Stays", body: "<p>x</p>" }), /<meta name="viewport" content="[^"]*interactive-widget=resizes-content/);
  // Failure path: the meta is not dropped when other viewport options are present.
  assert.match(renderGuestShellHtml(), /viewport-fit=cover, interactive-widget=resizes-content/);
});

test("AC2: The composer grows with content up to its limit, and browsers without field-sizing keep the current behaviour", () => {
  const html = readFileSync("apps/local-guest/src/guest-server.ts", "utf8");
  const rule = /#composer-input \{[^}]*\}/.exec(html)?.[0];
  assert.ok(rule);
  assert.match(rule, /field-sizing: content;/);
  assert.match(rule, /max-block-size: 8rem;/);
  // Failure path: the existing min-height keeps the untouched composer size as the fallback.
  assert.match(rule, /min-height: var\(--control-min-field\)/);
});

test("AC3: Composer text is at least 16px", () => {
  const html = readFileSync("apps/local-guest/src/guest-server.ts", "utf8");
  const rule = /#composer-input \{[^}]*\}/.exec(html)?.[0];
  assert.match(rule ?? "", /font-size: 1rem;/);
});
