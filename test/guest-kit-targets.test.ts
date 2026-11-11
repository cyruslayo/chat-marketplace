import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Issue 17 (ADR 0078; guideline §7): 44x44 targets, 12px text floor, aria-busy styling, prose wrapping and accent colours.

const CSS = readFileSync("apps/web/src/shortlet-foundations.css", "utf8");

test("AC1: No visible guest control is under 44 by 44 CSS px at any capture width", () => {
  assert.match(CSS, /\.ui-button--small \{[^}]*min-block-size: var\(--control-min-target\)/);
  assert.match(CSS, /\.ui-stay-card__count \{[^}]*min-block-size: var\(--control-min-target\)[^}]*min-inline-size: var\(--control-min-target\)/);
  // Failure path: the old 36px size is gone from the small button and photo count.
  assert.doesNotMatch(CSS, /\.ui-button--small \{[^}]*min-block-size: 2\.25rem/);
  assert.doesNotMatch(CSS, /\.ui-stay-card__count \{[^}]*min-block-size: 2\.25rem/);
});

test("AC2: No guest text is under 12px", () => {
  const sizes = [...CSS.matchAll(/font-size:\s*([\d.]+)rem/g)].map((match) => Number(match[1]));
  const undersized = sizes.filter((size) => size < 0.75);
  assert.deepEqual(undersized, [], `sizes: ${sizes.join(", ")}`);
  // Failure path: the old 11px rail label is gone.
  assert.doesNotMatch(CSS, /font-size:\s*0\.6875rem/);
});

test("AC3: A busy control styled only with aria-busy shows the busy state", () => {
  assert.match(CSS, /\.ui-button\[aria-busy="true"\] \{[^}]*cursor:\s*progress/);
  assert.match(CSS, /\.ui-button\[aria-busy="true"\]::before \{/);
  // Failure path: the existing data-loading hook keeps working.
  assert.match(CSS, /\.ui-button\[data-loading="true"\], \.ui-button\[aria-busy="true"\]/);
});
