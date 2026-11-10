import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { errorPage, pageShell } from "../apps/web/src/ui-kit.js";

// Issue 15 (ADR 0078, 0080): every standard guest page starts with a skip link to the main region.

test("AC1: Every standard guest page has a skip link as its first focusable element", () => {
  const plain = pageShell({ title: "Stays", body: "<p>x</p>", frame: '<header class="ui-appbar"><a href="/">Home</a></header>' });
  assert.match(plain, /<body><a class="ui-skip-link" href="#main-content">Skip to main content<\/a><header/);
  assert.ok(plain.indexOf('class="ui-skip-link"') < plain.indexOf('<header class="ui-appbar">'), "the link precedes the app bar");
  const error = errorPage({ status: 404, code: "NOT_FOUND", title: "Not found", message: "No page here." });
  assert.match(error, /<body><a class="ui-skip-link" href="#main-content">Skip to main content<\/a>/);
  // Failure path: the main region is addressable and focusable.
  assert.match(plain, /<main id="main-content" tabindex="-1" class="ui-page">/);
});

test("AC3: The skip link is at least 44 by 44 CSS px when focused", () => {
  const css = readFileSync("apps/web/src/shortlet-foundations.css", "utf8");
  const rule = /\.ui-skip-link \{[^}]*\}/.exec(css)?.[0];
  assert.ok(rule, "the kit defines .ui-skip-link");
  assert.match(rule, /min-block-size:\s*var\(--control-min-target\)/);
  assert.match(rule, /min-inline-size:\s*var\(--control-min-target\)/);
  assert.match(css, /\.ui-skip-link:focus \{[^}]*transform:\s*none/);
});
