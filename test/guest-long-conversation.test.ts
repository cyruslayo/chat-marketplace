import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Issue 24 (ADR 0078; guideline §12): older turns defer rendering, scroll position stays stable, and the skeleton is an
// opacity pulse.

const CLIENT = readFileSync("apps/local-guest/src/client.ts", "utf8");
const CSS = readFileSync("apps/web/src/shortlet-foundations.css", "utf8");

test("AC1: Older transcript turns are skipped for rendering until scrolled near, and keep their size, with no scroll jump", () => {
  assert.match(CLIENT, /const RENDERED_TURN_WINDOW = 6;/);
  assert.match(CLIENT, /turn\.classList\.toggle\("turn--deferred", index < cutoff\)/);
  const html = readFileSync("apps/local-guest/src/guest-server.ts", "utf8");
  assert.match(html, /#transcript \.turn--deferred \{ content-visibility: auto; contain-intrinsic-size: auto none auto 4rem; \}/);
  // Failure path: the deferral is bounded, so the newest turns are never deferred.
  assert.match(CLIENT, /Math\.max\(0, turns\.length - RENDERED_TURN_WINDOW\)/);
});

test("AC3: Opening or closing the workspace does not shift the layout when a scrollbar appears", () => {
  const html = readFileSync("apps/local-guest/src/guest-server.ts", "utf8");
  assert.match(html, /#transcript \{[^}]*scrollbar-gutter: stable;/);
  assert.match(html, /#workspace-region \{[^}]*scrollbar-gutter: stable;/);
});

test("AC4: The skeleton is a static block (no shimmer, no animation), per the round-12 Skeleton README", () => {
  // Issue 2b-01 (round-12 bundle.css) replaced the ui-pulse opacity pulse with a static placeholder (reduced motion by default).
  const skeletonRule = /\.ui-skeleton\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(skeletonRule, ".ui-skeleton rule exists");
  assert.match(skeletonRule[1]!, /background:\s*var\(--color-surface-subtle\)/);
  assert.doesNotMatch(skeletonRule[1]!, /\banimation\b/);
  // Failure path: the old background-position shimmer is gone.
  assert.doesNotMatch(CSS, /ui-shimmer/);
  assert.doesNotMatch(CSS, /background-position: -200% 0/);
});
