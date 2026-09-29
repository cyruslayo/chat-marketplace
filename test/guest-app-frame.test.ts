import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { renderGuestShellHtml, startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { BOOKING_STAGE_PAGES, railSteps, withStagePage } from "./helpers/guest-stage-pages.js";

const SEARCH_PATH = "/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2";

async function withPublicServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "guest-app-frame-"));
  const server = startLocalGuestServer({ port: 0, environment: new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite"), clock: () => new Date("2026-09-03T10:00:00Z") }) });
  try {
    return await run(`http://127.0.0.1:${await server.listen()}`);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("AC1: every standalone guest page renders the app bar and the journey rail, and the back control points to its own conversation", async () => {
  for (const spec of BOOKING_STAGE_PAGES) {
    await withStagePage(spec, async ({ fixture, path, threadId }) => {
      const response = await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie, accept: "text/html" } });
      const html = await response.text();
      assert.equal(response.status, 200, `${spec.label} (${path})`);
      assert.match(html, /<header class="ui-appbar">/, `${spec.label}: app bar`);
      assert.match(html, /<ol class="ui-rail">/, `${spec.label}: journey rail`);
      assert.match(html, new RegExp(`<a class="ui-icon-button" href="/\\?threadId=${threadId}" aria-label="Back to your conversation">`), `${spec.label}: back control targets its own thread`);
      assert.equal(railSteps(html).length, 6, `${spec.label}: six steps`);
    });
  }
  // Failure path: a public page has no thread, so it goes back to "/" and the rail shows only the step it is on.
  await withPublicServer(async (base) => {
    const search = await (await fetch(`${base}${SEARCH_PATH}`)).text();
    assert.match(search, /<a class="ui-icon-button" href="\/" aria-label="Back to your conversation">/);
    assert.deepEqual(railSteps(search).filter(([, state]) => state === "current"), [["search", "current"]]);
    const unit = await (await fetch(`${base}/stays/unit-lagos-ikoyi-001`)).text();
    assert.match(unit, /<header class="ui-appbar">/);
    assert.match(unit, /<a class="ui-icon-button" href="\/" aria-label="Back to your conversation">/);
    assert.deepEqual(railSteps(unit).filter(([, state]) => state === "current"), [["stay", "current"]]);
    assert.doesNotMatch(unit, /threadId=/, "no thread id is invented for a public page");
  });
});

test("AC2: for a given thread, the rail on a standalone page shows the same steps and states as the chat's rail, including a failed outcome", async () => {
  let sawFailed = false;
  for (const spec of BOOKING_STAGE_PAGES) {
    await withStagePage(spec, async ({ fixture, path }) => {
      const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie, accept: "text/html" } })).text();
      const state = await fixture.state();
      assert.equal(state.ok, true);
      const chat = (state as { journey?: { steps: readonly { id: string; state: string }[] } }).journey?.steps.map((step) => [step.id, step.state] as const);
      assert.ok(chat, `${spec.label}: the chat has a journey`);
      assert.deepEqual(railSteps(html), chat, `${spec.label}: page and chat agree`);
      if (chat.some(([, stepState]) => stepState === "failed")) sawFailed = true;
    });
  }
  assert.ok(sawFailed, "the parity check covered a failed outcome");
});

test("AC3: the chat shell's CSS defines no colour of its own: no hex values and no shell-local colour custom properties", () => {
  const html = renderGuestShellHtml();
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]!).join("\n");
  assert.ok(styles.length > 1000, "the shell has a style block");
  assert.doesNotMatch(styles, /#[0-9A-Fa-f]{3,8}\b(?![-\w])/, "no hex colour in the shell style");
  assert.doesNotMatch(styles, /^\s*--(?:bg|surface|surface-soft|border|text|text-muted|accent|accent-hover|user-bubble|focus|danger)\s*:/m, "no shell-local colour custom property is defined");
  assert.doesNotMatch(styles, /var\(--(?:bg|surface|surface-soft|border|text|text-muted|accent|accent-hover|user-bubble|focus|danger)\)/, "no shell-local colour variable is read");
});

test("AC3 failure path: the shell uses the shared app bar, rail and chip components", () => {
  const html = renderGuestShellHtml();
  assert.match(html, /<header class="ui-appbar">/);
  assert.match(html, /<nav id="journey-rail" class="ui-rail-nav"[^>]*hidden><ol class="ui-rail"><\/ol><\/nav>/);
  assert.match(html, /id="new-conversation"[^>]*>/);
  assert.match(html, /aria-label="Send"/);
});
