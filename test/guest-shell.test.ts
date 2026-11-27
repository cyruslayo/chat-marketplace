import assert from "node:assert/strict";
import test from "node:test";
import { datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { coldApp, JOURNEY_SCRIPT, JOURNEY_TEXT, successOf } from "./helpers/assistant-stage-journey.js";
import { accountFixture, getPage, signInDevice, advanceToPendingWithPhone, CapturingEmailSender } from "./helpers/guest-account-sign-in.js";
import { deviceCookies } from "./helpers/guest-account-page.js";
import { BOOKING_STAGE_PAGES, withStagePage } from "./helpers/guest-stage-pages.js";
import { GUEST_NAVIGATION_TABLE } from "./guest-navigation.test.js";

// Issue 15: Tab bar, Ask bar, Task bar and Guest Side navigation.
// ADRs: 0074, 0078, 0080, 0106, 0107.

test("AC1: Navigation table has no remaining tab-bar, task-chrome, or list-reachability gaps on section/state pages", () => {
  for (const row of GUEST_NAVIGATION_TABLE) {
    if (row.planned !== undefined) continue;
    assert.ok(!row.gaps.some((g) => g.rule === "N4"), `${row.id} has no remaining N4 tab-bar gap`);
    assert.ok(!row.gaps.some((g) => g.rule === "N5"), `${row.id} has no remaining N5 task-chrome gap`);
    if (row.kind === "section" || (row.kind === "state" && !["welcome", "partners", "partners-applied"].includes(row.id))) {
      assert.ok(!row.gaps.some((g) => g.rule === "N3"), `${row.id} (${row.kind}) has no remaining N3 /plans gap`);
    }
  }
});

test("AC3: Section pages have TabBar + SideNav + AskBar (except chat); Task pages have TaskBar with sole <h1> and no TabBar", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const home = await getPage(fixture.base, "/", fixture.cookie);
    assert.equal(home.status, 200);
    assert.match(home.body, /class="ui-tabbar"/);
    assert.match(home.body, /class="ui-sidenav ui-sidenav--guest"/);
    assert.match(home.body, /aria-current="page"[^>]*>.*?Find/s);
    assert.doesNotMatch(home.body, /Change concierge|ui-domain-tag/);

    const plans = await getPage(fixture.base, "/plans", fixture.cookie);
    assert.equal(plans.status, 200);
    assert.match(plans.body, /class="ui-tabbar"/);
    assert.match(plans.body, /class="ui-ask"/);
    assert.match(plans.body, /Ask about your stays/);
    assert.match(plans.body, /class="ui-sidenav ui-sidenav--guest"/);

    const signed = await signInDevice(fixture, sender, "ada@example.test", fixture.cookie);
    const account = await getPage(fixture.base, "/account", deviceCookies(signed));
    assert.equal(account.status, 200);
    assert.match(account.body, /class="ui-tabbar"/);
    assert.match(account.body, /class="ui-ask"/);
    assert.match(account.body, /Ask the concierge/);

    // Task pages: TaskBar with Close {task}, sole <h1>, no TabBar, no SideNav
    for (const spec of BOOKING_STAGE_PAGES.filter((s) => ["review", "offer", "payment-ready"].includes(s.stage))) {
      await withStagePage(spec, async ({ fixture: f, path }) => {
        const res = await getPage(f.base, path, f.cookie);
        assert.equal(res.status, 200);
        assert.match(res.body, /class="ui-appbar ui-appbar--task"/, `${spec.label} has TaskBar`);
        assert.match(res.body, /aria-label="Close /, `${spec.label} has Close {task}`);
        assert.equal((res.body.match(/<h1\b/gi) ?? []).length, 1, `${spec.label} has sole <h1>`);
        assert.doesNotMatch(res.body, /class="ui-tabbar"/, `${spec.label} hides TabBar`);
        assert.doesNotMatch(res.body, /class="ui-sidenav/, `${spec.label} hides SideNav`);
      });
    }
  } finally {
    await fixture.close();
  }
});

test("AC4: Closing a task is a plain GET link that sends no command and leaves server state unchanged", async () => {
  await withStagePage(BOOKING_STAGE_PAGES[0]!, async ({ fixture, path }) => {
    const beforeRequests = fixture.environment.interactionStore.listBookingRequestIds().length;
    const res = await getPage(fixture.base, path, fixture.cookie);
    assert.equal(res.status, 200);
    const closeMatch = /<header class="ui-appbar ui-appbar--task"><a class="ui-appbar__action" href="([^"]+)" aria-label="Close /.exec(res.body);
    assert.ok(closeMatch, "TaskBar renders plain <a href> Close link");
    const closeRes = await getPage(fixture.base, closeMatch[1]!.replace(/&amp;/g, "&"), fixture.cookie);
    assert.equal(closeRes.status, 200);
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, beforeRequests, "closing sends no command");
  });
});

test("AC5: Forged or stale Ask context opens a plain conversation; assistant cold restore and criteria strip stay intact", async () => {
  const { fixture } = await accountFixture();
  try {
    for (const badContext of [
      "offer:forged-offer-id",
      "request:../etc/passwd",
      "stay:nonexistent-unit",
      "payment:missing-offer",
      "unknown:123",
      "a".repeat(300),
    ]) {
      const res = await getPage(fixture.base, `/?context=${encodeURIComponent(badContext)}`, fixture.cookie);
      assert.equal(res.status, 200, `forged/stale context ${badContext.slice(0, 24)} opens plain conversation`);
      assert.match(res.body, /id="composer"/);
      assert.doesNotMatch(res.body, /forged-offer-id|nonexistent-unit|missing-offer/);
    }
  } finally {
    await fixture.close();
  }

  // Assistant cold-restore parity + criteria strip on assistant responses (ADR 0106)
  const f = datedFixture(scriptedPlanner(JOURNEY_SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000401";
    const search = successOf(await coldApp(f, threadId, scriptedPlanner(JOURNEY_SCRIPT).client).app.handleTurn(threadId, JOURNEY_TEXT), "search");
    assert.ok(search.criteria, "criteria strip is returned on assistant responses");
    assert.equal(search.criteria.when?.nights, 3);
    assert.equal(search.criteria.guests?.count, 2);
  } finally {
    f.close();
  }
});

test("AC6: Without JavaScript, tabs and Ask bar work as plain links and pages", async () => {
  const { fixture } = await accountFixture();
  try {
    await advanceToPendingWithPhone(fixture);
    const plans = await getPage(fixture.base, "/plans", fixture.cookie);
    assert.equal(plans.status, 200);
    const askMatch = /<div class="ui-ask"><a class="ui-composer ui-composer--link" href="([^"]+)"/.exec(plans.body);
    assert.ok(askMatch, "Ask bar is a plain <a href>");
    const askTarget = await getPage(fixture.base, askMatch[1]!.replace(/&amp;/g, "&"), fixture.cookie);
    assert.equal(askTarget.status, 200);
    assert.match(askTarget.body, /id="composer"/);
  } finally {
    await fixture.close();
  }
});
