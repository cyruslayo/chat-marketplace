import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { GUEST_PLANS_COPY } from "../apps/web-agent/src/guest-content.js";
import {
  accountFixture,
  advanceClock,
  advanceToPendingWithPhone,
  CapturingEmailSender,
  CODE_REQUEST_COOLDOWN_MS,
  getPage,
  signInDevice,
} from "./helpers/guest-account-sign-in.js";
import { deviceCookies } from "./helpers/guest-account-page.js";
import {
  datedFixture,
  firstButtonAction,
  LIVE_LIKE_CLOCK,
  scriptedPlanner,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";
import {
  coldApp,
  JOURNEY_SCRIPT,
  JOURNEY_TEXT,
  PHONE,
  successOf,
  tap,
  typedTurn,
} from "./helpers/assistant-stage-journey.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

// Issue 11: Guest's list at /plans (rules/02, D8, D9, D10).
// ADRs: 0005, 0071, 0074, 0077, 0078, 0080, 0085, 0093, 0106.

const PLANS_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  ...JOURNEY_SCRIPT,
};

async function driveDeviceToPending(
  fixture: Awaited<ReturnType<typeof accountFixture>>["fixture"],
  text: string,
  email?: string,
): Promise<string> {
  const turn = await fixture.send("/api/turn", { text });
  assert.equal(turn.ok, true);
  const view = await fixture.send("/api/event", guestAction((turn as any).surfaces[0]));
  assert.equal(view.ok, true);
  const draft = await fixture.send("/api/event", guestAction((view as any).surfaces[0]));
  assert.equal(draft.ok, true);
  const review = await fixture.send("/api/event", guestAction((draft as any).surfaces[0]));
  assert.equal(review.ok, true);
  const phoneSurface = (review as any).surfaces.find((s: { surfaceId: string }) => s.surfaceId.includes(":contact:phone"));
  assert.ok(phoneSurface);
  const save = guestAction(phoneSurface);
  const saved = await fixture.send("/api/event", { ...save, context: { ...save.context, contactValue: PHONE } });
  assert.equal(saved.ok, true);
  if (email !== undefined) {
    const principalId = fixture.environment.interactionStore.findThread(fixture.threadId)?.principalId;
    assert.ok(principalId);
    const principal = { id: principalId, role: "guest" as const, tenantId: fixture.environment.config.tenantId };
    const revision = fixture.environment.guestContactApp.get(principal)?.revision ?? 0;
    fixture.environment.guestContactApp.submitEmail({ contactEmail: email, expectedRevision: revision }, principal);
  }
  const pending = await fixture.send("/api/event", guestAction((saved as any).surfaces[0]));
  assert.equal(pending.ok, true);
  return (pending as any).surfaces[0].surfaceId.split(":").at(-1)!;
}

function guestAction(surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }) {
  const update = surface.a2uiMessages.find((m): m is { updateComponents: { components: readonly { component: string; action?: { event?: { name: string; context: Record<string, unknown> } } }[] } } => typeof m === "object" && m !== null && "updateComponents" in m);
  assert.ok(update);
  const event = update.updateComponents.components.find((c) => c.component === "Button" && c.action?.event)?.action?.event;
  assert.ok(event);
  return { name: event.name, context: event.context, surfaceId: surface.surfaceId, sourceComponentId: "test", timestamp: new Date().toISOString() };
}

test("AC1: Every cell of the rules 02 decision table (6 viewers × 4 bookings = 24 cells) is enforced on GET /plans", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plans-24-"));
  const databasePath = join(dir, "guest.sqlite");
  const sender = new CapturingEmailSender();
  const devA = (await accountFixture({ databasePath, sender })).fixture;
  const devB = (await accountFixture({ databasePath, sender })).fixture;
  const devClaimed = (await accountFixture({ databasePath, sender })).fixture;
  const devC = (await accountFixture({ databasePath, sender })).fixture;
  try {
    const ownReqId = await driveDeviceToPending(devA, "I need an apartment in Ikoyi from 10 Sept for 2 nights for 1 person");
    const linkedReqId = await driveDeviceToPending(devB, "I need an apartment in Ikoyi from 15 Sept for 2 nights for 1 person");
    const claimedReqId = await driveDeviceToPending(devClaimed, "I need an apartment in Ikoyi from 20 Sept for 2 nights for 1 person", "ada@example.test");
    const foreignReqId = await driveDeviceToPending(devC, "I need an apartment in Ikoyi from 25 Sept for 2 nights for 1 person");

    // 1. Device session (signed out): sees own only
    const deviceOnlyPage = await getPage(devA.base, "/plans", devA.cookie);
    assert.equal(deviceOnlyPage.status, 200);
    assert.ok(deviceOnlyPage.body.includes(ownReqId));
    assert.ok(!deviceOnlyPage.body.includes(linkedReqId));
    assert.ok(!deviceOnlyPage.body.includes(claimedReqId));
    assert.ok(!deviceOnlyPage.body.includes(foreignReqId));

    // Sign in devA and devB as ada@example.test (advance clock for cooldown), devC as grace@example.test
    const signedA = await signInDevice(devA, sender, "ada@example.test", devA.cookie);
    advanceClock(devB, CODE_REQUEST_COOLDOWN_MS);
    const signedB = await signInDevice(devB, sender, "ada@example.test", devB.cookie);
    const signedC = await signInDevice(devC, sender, "grace@example.test", devC.cookie);

    const cookiesA = deviceCookies(signedA);
    const cookiesB = deviceCookies(signedB);
    const cookiesC = deviceCookies(signedC);

    // Sign out devA to test signed_out_again
    const signOutRes = await fetch(`${devA.base}/account/sign-out`, {
      method: "POST",
      headers: { cookie: cookiesA, origin: devA.base },
      redirect: "manual",
    });
    assert.equal(signOutRes.status, 303);
    const rotatedAfterSignOut = signOutRes.headers.get("set-cookie")?.split(";")[0]!;

    const viewers = [
      { name: "no_session", base: devA.base, cookie: undefined, expectedStatus: 401, expected: [] as string[] },
      { name: "signed_in_a", base: devB.base, cookie: cookiesB, expectedStatus: 200, expected: [ownReqId, linkedReqId, claimedReqId] },
      { name: "signed_in_b", base: devB.base, cookie: cookiesB, expectedStatus: 200, expected: [ownReqId, linkedReqId, claimedReqId] },
      { name: "signed_out_again", base: devA.base, cookie: rotatedAfterSignOut, expectedStatus: 200, expected: [] as string[] },
      { name: "another_guest_c", base: devC.base, cookie: cookiesC, expectedStatus: 200, expected: [foreignReqId] },
    ];
    const bookings = [
      { name: "own", id: ownReqId },
      { name: "linked", id: linkedReqId },
      { name: "claimed", id: claimedReqId },
      { name: "foreign", id: foreignReqId },
    ];

    for (const viewer of viewers) {
      const page = await getPage(viewer.base, "/plans", viewer.cookie);
      assert.equal(page.status, viewer.expectedStatus, `${viewer.name} status`);
      for (const booking of bookings) {
        const shouldSee = viewer.expected.includes(booking.id);
        assert.equal(page.body.includes(booking.id), shouldSee, `cell (${viewer.name} × ${booking.name})`);
      }
    }
  } finally {
    await devC.close();
    await devClaimed.close();
    await devB.close();
    await devA.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2: After sign-out, no account row is visible on GET /plans", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plans-ac2-"));
  const databasePath = join(dir, "guest.sqlite");
  const sender = new CapturingEmailSender();
  const devA = (await accountFixture({ databasePath, sender })).fixture;
  const devB = (await accountFixture({ databasePath, sender })).fixture;
  try {
    const otherReqId = (await advanceToPendingWithPhone(devA)).surfaces[0]!.surfaceId.split(":").at(-1)!;
    await signInDevice(devA, sender, "ada@example.test", devA.cookie);
    advanceClock(devB, CODE_REQUEST_COOLDOWN_MS);
    const signedB = await signInDevice(devB, sender, "ada@example.test", devB.cookie);
    const cookiesB = deviceCookies(signedB);

    const beforeSignOut = await getPage(devB.base, "/plans", cookiesB);
    assert.equal(beforeSignOut.status, 200);
    assert.ok(beforeSignOut.body.includes(otherReqId), "signed-in device sees account row before sign-out");

    const signOutRes = await fetch(`${devB.base}/account/sign-out`, {
      method: "POST",
      headers: { cookie: cookiesB, origin: devB.base },
      redirect: "manual",
    });
    assert.equal(signOutRes.status, 303);
    const rotatedCookie = signOutRes.headers.get("set-cookie")?.split(";")[0] ?? devB.cookie;

    const afterSignOut = await getPage(devB.base, "/plans", rotatedCookie);
    assert.equal(afterSignOut.status, 200);
    assert.ok(!afterSignOut.body.includes(otherReqId), "account row is gone after sign-out");
  } finally {
    await devB.close();
    await devA.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3: Each row opens its own page, and state transitions update /plans lazily", async () => {
  const { fixture } = await accountFixture();
  try {
    const requestId = (await advanceToPendingWithPhone(fixture)).surfaces[0]!.surfaceId.split(":").at(-1)!;

    const requestPlans = await getPage(fixture.base, "/plans", fixture.cookie);
    assert.equal(requestPlans.status, 200);
    assert.match(requestPlans.body, new RegExp(`/booking-requests/${requestId}`));

    const requestPage = await getPage(fixture.base, `/booking-requests/${requestId}`, fixture.cookie);
    assert.equal(requestPage.status, 200);

    fixture.environment.simulateOperatorAcceptance(requestId);
    await fixture.state();
    const offerPlans = await getPage(fixture.base, "/plans", fixture.cookie);
    assert.equal(offerPlans.status, 200);
    assert.match(offerPlans.body, /Offer ready/);
    const offerMatch = offerPlans.body.match(/href="(\/conditional-offers\/[^"]+)"/);
    assert.ok(offerMatch, "row links to conditional offer");
    const offerPage = await getPage(fixture.base, offerMatch[1]!, fixture.cookie);
    assert.equal(offerPage.status, 200);
  } finally {
    await fixture.close();
  }
});

test("AC4: Chat and /plans page show the same rows and words", async () => {
  const f = datedFixture(scriptedPlanner(PLANS_SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000399";
    const search = successOf(await typedTurn(f, threadId, JOURNEY_TEXT, PLANS_SCRIPT), "search");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, {
      ...phoneSave,
      context: { ...phoneSave.context, contactValue: PHONE },
    }), "Save phone");
    const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
    const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
    f.environment.simulateOperatorAcceptance(requestId);

    const composed = await coldApp(f, threadId).app.planRows(f.environment.guestPrincipal(), undefined, LIVE_LIKE_CLOCK());
    assert.equal(composed.groups.needs_action.length, 1);
    const row = composed.groups.needs_action[0]!;
    const chatCard = await import("../apps/local-guest/src/guest-kit.js").then((m) =>
      m.plansChatCardProps(composed, { multiDomain: false }),
    );
    assert.equal(chatCard.title, GUEST_PLANS_COPY.titleSingleDomain);
    assert.ok(chatCard.rows && chatCard.rows.length === 1);
    assert.ok(chatCard.rows[0]!.text.includes(row.title));
    assert.ok(chatCard.rows[0]!.text.includes(row.status.label));
    assert.equal(chatCard.rows[0]!.href, row.href);
  } finally {
    f.close();
  }
});

test("AC5: /plans works without JavaScript as plain HTML", async () => {
  const { fixture } = await accountFixture();
  try {
    const plansEmpty = await getPage(fixture.base, "/plans", fixture.cookie);
    assert.equal(plansEmpty.status, 200);
    assert.match(plansEmpty.body, /<h1[^>]*>Your stays<\/h1>/);
    assert.match(plansEmpty.body, /No stays yet/);
    assert.doesNotMatch(plansEmpty.body, /<script\b/i, "/plans needs no client script");
  } finally {
    await fixture.close();
  }
});

test("AC6: GET /plans with no session is refused (401) and reveals nothing", async () => {
  const { fixture } = await accountFixture();
  try {
    const res = await fetch(`${fixture.base}/plans`, { headers: { accept: "text/html" } });
    const body = await res.text();
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(body, /booking-requests|conditional-offers|booking-contracts|No stays yet/i);
  } finally {
    await fixture.close();
  }
});

test("N7 and S6: single domain uses 'Your stays' without domain tags; multi-domain uses 'Your plans' and shows domain tags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plans-multi-"));
  const env = LocalGuestEnvironment.openNode({ databasePath: join(dir, "guest.sqlite"), clock: LIVE_LIKE_CLOCK });
  try {
    const single = await import("../apps/local-guest/src/guest-kit.js").then((m) =>
      m.plansListHtml(
        { groups: { needs_action: [], in_progress: [], past: [] }, badgeCount: 0, droppedDomains: [] },
        { multiDomain: false },
      ),
    );
    assert.match(single, /Your stays/);
    assert.doesNotMatch(single, /Your plans|ui-domain-tag/);

    const fakeShop = createFakeShopPack({ planRows: () => [] });
    const staysPack = createShortletAssistantPack(env);
    assert.ok(staysPack && fakeShop);
    const multi = await import("../apps/local-guest/src/guest-kit.js").then((m) =>
      m.plansListHtml(
        {
          groups: {
            needs_action: [
              {
                rowId: "stays:offer:o1",
                domain: "shortlet",
                title: "2-bedroom apartment",
                where: "Wuse, Abuja",
                startsOn: "2026-12-03",
                endsOn: "2026-12-06",
                group: "needs_action",
                status: { tone: "warning", label: "Offer ready" },
                nextStep: { label: "Review and accept offer", deadlineAt: "2026-10-27T11:44:00.000Z" },
                href: "/conditional-offers/o1",
              },
            ],
            in_progress: [],
            past: [],
          },
          badgeCount: 1,
          droppedDomains: ["shop"],
        },
        { multiDomain: true },
      ),
    );
    assert.match(multi, /Your plans/);
    assert.match(multi, /ui-domain-tag/);
    assert.match(multi, /ui-banner--warning/);
  } finally {
    env.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
