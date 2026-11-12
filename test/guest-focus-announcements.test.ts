import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";

// Issue 14 (ADR 0078; guideline §12): one H1 per route, polite criteria status, and one announcement source per turn.

test("AC3: Criteria status messages are polite, and only errors use the alert region", () => {
  const html = renderGuestShellHtml();
  assert.match(html, /<p id="criteria-status" class="criteria-status" role="status"><\/p>/);
  assert.match(html, /<div id="error-announcer" class="sr-only" role="alert" aria-live="assertive" aria-atomic="true"><\/div>/);
  // Failure path: the criteria strip is not an alert region.
  assert.doesNotMatch(html, /id="criteria-status"[^>]*role="alert"/);
});

test("AC4: Each guest route has exactly one H1, naming the current task", () => {
  const html = renderGuestShellHtml();
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "exactly one H1");
  assert.match(html, /<h1 id="route-heading" class="conversation-heading">Find a place to stay<\/h1>/);
  // Failure path: the brand is no longer a heading.
  assert.match(html, /<a class="header-identity ui-appbar__brand" href="\/" aria-label="Shortlet home"><span>Shortlet<\/span><\/a>/);
  assert.doesNotMatch(html, /<a[^>]*header-identity[^>]*>\s*<h1>/);
});

test("AC2: A turn with an assistant message is announced by the transcript, not twice", () => {
  const source = readFileSync("apps/local-guest/src/client.ts", "utf8");
  assert.match(source, /transcriptAnnouncesTurn = \(response\.messages \?\? \[\]\)\.length > 0;/);
  assert.match(source, /if \(moveFocus && !transcriptAnnouncesTurn\) announce\(/);
});
