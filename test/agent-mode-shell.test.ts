import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as guestKit from "../apps/local-guest/src/guest-kit.js";
import { LocalGuestApp, renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import * as guestContent from "../apps/web-agent/src/guest-content.js";
import type { GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { assertValidResponseMode } from "../apps/local-guest/src/response-mode.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { coldApp, PHONE, SCRIPT, STAY_TEXT, successOf, tap } from "./helpers/assistant-cold-journey-harness.js";

// Issue 01 of the agent-modes effort (ADR 0107 decisions 1, 5, 6): the stays presentation is the one copy source for the
// chat shell, the no-JS conversation page and the client announcements, and every guest response carries the mode.
// The two modules that gain new exports are namespace-imported, so this file loads before those exports exist and each
// criterion fails on its own reason rather than the whole file failing at import.
const { GUEST_MODES, validateModePresentation } = guestContent;
const { composerHtml } = guestKit;

/**
 * The stays presentation in the nested shape of architecture-analysis.md 5.2, with `composer.ariaLabel` added.
 * Copy as it stands on main at 16d592e: guest-server.ts:577-612 and :774, client.ts:1881, :1887 and :2599, the registered
 * Stays vertical (shortlet-assistant-pack.ts:1520-1521) and GUEST_VERTICALS.staysDescription. Pinned literally.
 */
const STAYS = {
  id: "stays",
  label: "Stays",
  persona: { name: "Stays", icon: "home" },
  tagline: "Find an inspected apartment in Lagos or Abuja and book it.",
  emptyState: {
    heading: "Find a place to stay",
    body: "Start with a city, your dates (or length of stay), and number of guests. We’ll find available entire-place stays and guide you through requesting one.",
    starters: [
      { label: "Explore Abuja", prompt: "I’m looking for a stay in Abuja" },
      { label: "Explore Lagos", prompt: "I’m looking for a stay in Lagos" },
    ],
  },
  composer: {
    label: "Your message",
    ariaLabel: "Message the concierge",
    placeholder: "Area, dates, guests",
    hint: "Share a city or neighbourhood, dates or nights, and number of guests.",
  },
  workspace: {
    regionLabel: "Current stay details",
    reopenLabel: "Return to your current stay details",
    returnedAnnouncement: "Returned to the conversation. Your stay details are still here.",
    readyAnnouncement: "Conversation ready. Your stay details are still here.",
    workingStatus: "Working on your request… Your stay details will stay here.",
  },
  criteria: { regionLabel: "Your search", editLabel: "Edit search" },
} as const;

/** Every stays string, flattened, so AC3 can prove none of it leaks into another mode's shell. */
const STAYS_STRINGS: readonly string[] = [
  STAYS.label,
  STAYS.persona.name,
  STAYS.tagline,
  STAYS.emptyState.heading,
  STAYS.emptyState.body,
  ...STAYS.emptyState.starters.flatMap((starter) => [starter.label, starter.prompt]),
  STAYS.composer.label,
  STAYS.composer.ariaLabel,
  STAYS.composer.placeholder,
  STAYS.composer.hint,
  STAYS.workspace.regionLabel,
  STAYS.workspace.reopenLabel,
  STAYS.workspace.returnedAnnouncement,
  STAYS.workspace.readyAnnouncement,
  STAYS.workspace.workingStatus,
  STAYS.criteria.regionLabel,
  STAYS.criteria.editLabel,
];

type Loose = Record<string, unknown>;

/** A nested object of a loosely typed copy, for the refusal cases in AC2. */
function section(copy: Loose, key: string): Loose {
  return copy[key] as Loose;
}

/** A deep copy of the stays presentation with one change, for the refusal cases in AC2. */
function staysVariant(change: (copy: Loose) => void): unknown {
  const copy = JSON.parse(JSON.stringify(GUEST_MODES.stays)) as Loose;
  change(copy);
  return copy;
}

test("AC1: The stays presentation holds the current shell copy unchanged", () => {
  const stays = GUEST_MODES.stays;
  assert.equal(Object.isFrozen(stays), true, "the stays presentation is frozen");
  assert.equal(stays.id, STAYS.id);
  assert.equal(stays.label, STAYS.label);
  assert.equal(stays.persona.name, STAYS.persona.name);
  assert.equal(stays.persona.icon, STAYS.persona.icon);
  assert.equal(stays.tagline, STAYS.tagline);
  assert.equal(stays.emptyState.heading, STAYS.emptyState.heading);
  assert.equal(stays.emptyState.body, STAYS.emptyState.body);
  assert.deepEqual(stays.emptyState.starters, STAYS.emptyState.starters);
  assert.equal(stays.composer.label, STAYS.composer.label);
  assert.equal(stays.composer.ariaLabel, STAYS.composer.ariaLabel);
  assert.equal(stays.composer.placeholder, STAYS.composer.placeholder);
  assert.equal(stays.composer.hint, STAYS.composer.hint);
  assert.equal(stays.workspace.regionLabel, STAYS.workspace.regionLabel);
  assert.equal(stays.workspace.reopenLabel, STAYS.workspace.reopenLabel);
  assert.equal(stays.workspace.returnedAnnouncement, STAYS.workspace.returnedAnnouncement);
  assert.equal(stays.workspace.readyAnnouncement, STAYS.workspace.readyAnnouncement);
  assert.equal(stays.workspace.workingStatus, STAYS.workspace.workingStatus);
  assert.equal(stays.criteria?.regionLabel, STAYS.criteria.regionLabel);
  assert.equal(stays.criteria?.editLabel, STAYS.criteria.editLabel);
});

test("AC2: A malformed presentation is refused", () => {
  assert.equal(typeof validateModePresentation(staysVariant(() => {})), "object", "the well-formed stays presentation validates");

  const starter = { label: "Explore Abuja", prompt: "I’m looking for a stay in Abuja" };
  const refused: readonly (readonly [string, unknown])[] = [
    ["an unknown top-level key", staysVariant((copy) => { copy.surprise = "not a field"; })],
    ["an unknown nested key", staysVariant((copy) => { section(copy, "composer").surprise = "not a field"; })],
    ["a missing id", staysVariant((copy) => { delete copy.id; })],
    ["an empty emptyState heading", staysVariant((copy) => { section(copy, "emptyState").heading = ""; })],
    ["zero emptyState starters", staysVariant((copy) => { section(copy, "emptyState").starters = []; })],
    ["five emptyState starters", staysVariant((copy) => { section(copy, "emptyState").starters = [starter, starter, starter, starter, starter]; })],
    ["an over-long string", staysVariant((copy) => { section(copy, "emptyState").body = "x".repeat(2001); })],
    ["an unknown persona icon", staysVariant((copy) => { section(copy, "persona").icon = "not-a-kit-icon"; })],
    ["a missing persona", staysVariant((copy) => { delete copy.persona; })],
    ["null", null],
    ["a string", "x"],
    ["a number", 42],
    ["an array", []],
  ];
  for (const [label, candidate] of refused) {
    assert.equal(validateModePresentation(candidate), undefined, `refuses ${label}`);
  }
});

test("AC3: The chat shell is rendered from the presentation", () => {
  // Test-only presentation: every string differs from the stays copy, so a leak shows up as a stays string in the markup.
  const testMode = {
    id: "stays",
    label: "TEST LABEL MODE",
    persona: { name: "TEST PERSONA", icon: "message-plus" },
    tagline: "TEST TAGLINE",
    emptyState: {
      heading: "TEST HEADING",
      body: "TEST BODY for the empty state",
      starters: [
        { label: "TEST STARTER ONE", prompt: "TEST PROMPT ONE" },
        { label: "TEST STARTER TWO", prompt: "TEST PROMPT TWO" },
      ],
    },
    composer: { label: "TEST LABEL", ariaLabel: "TEST COMPOSER", placeholder: "TEST PLACEHOLDER", hint: "TEST HINT" },
    workspace: {
      regionLabel: "TEST WORKSPACE REGION",
      reopenLabel: "TEST REOPEN",
      returnedAnnouncement: "TEST RETURNED",
      readyAnnouncement: "TEST READY",
      workingStatus: "TEST WORKING",
    },
    criteria: { regionLabel: "TEST CRITERIA REGION", editLabel: "TEST EDIT" },
  } as const;

  const html = renderGuestShellHtml(testMode);
  const shown = [
    "TEST HEADING",
    "TEST BODY for the empty state",
    "TEST STARTER ONE",
    "TEST PROMPT ONE",
    "TEST STARTER TWO",
    "TEST PROMPT TWO",
    "TEST LABEL",
    "TEST COMPOSER",
    "TEST PLACEHOLDER",
    "TEST HINT",
    "TEST WORKSPACE REGION",
    "TEST REOPEN",
    "TEST CRITERIA REGION",
    "TEST EDIT",
  ];
  for (const text of shown) assert.ok(html.includes(text), `the shell shows ${text}`);
  // The leak check reads rendered markup only: the shell's CSS and HTML comments are developer notes, not guest-visible copy.
  const markup = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const text of STAYS_STRINGS) assert.equal(markup.includes(text), false, `the shell hides the stays copy: ${text}`);
});

test("AC4: The default shell is unchanged", () => {
  // The snapshot was taken from the unchanged code (before issue 01). Only <html> gains data-mode="stays".
  // The render's template literals are LF; a CRLF working copy of the fixture must not fail the comparison.
  const snapshot = readFileSync(new URL("./fixtures/guest-shell-pre-agent-modes.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const htmlTag = '<html lang="en-NG" data-theme="system">';
  assert.equal(snapshot.split(htmlTag).length, 2, "the snapshot has exactly one <html> tag to mark");
  const expected = snapshot.replace(htmlTag, '<html lang="en-NG" data-theme="system" data-mode="stays">');
  assert.equal(renderGuestShellHtml(), expected);
});

test("AC5: The no-JS conversation page uses the same composer copy", async () => {
  const fixture = await restartFixture();
  try {
    const response = await fetch(`${fixture.base}/conversation?threadId=${fixture.threadId}`, {
      headers: { accept: "text/html", cookie: fixture.cookie },
    });
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.ok(page.includes(`aria-label="${GUEST_MODES.stays.composer.ariaLabel}"`), "the page composer carries the stays aria-label");
    assert.ok(page.includes(`>${GUEST_MODES.stays.composer.label}</label>`), "the page composer carries the stays label");
    assert.ok(page.includes(`>${GUEST_MODES.stays.composer.hint}</p>`), "the page composer carries the stays hint");

    // The markup comes from the shared kit helper, not from a copy in guest-server.ts.
    const fragment = composerHtml(GUEST_MODES.stays, "page");
    for (const text of [GUEST_MODES.stays.composer.ariaLabel, GUEST_MODES.stays.composer.label, GUEST_MODES.stays.composer.hint]) {
      assert.ok(fragment.includes(text), `composerHtml renders ${text}`);
    }
  } finally {
    await fixture.close();
  }
});

test("AC6: Every guest response carries the mode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mode-shell-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-a9e0c0de0601";

    const turn = await app.handleTurn(threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    assert.equal(turn.mode?.id, "stays", "a turn carries the mode");

    const update = turn.surfaces[0]?.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
    assert.ok(update);
    const button = update.updateComponents.components.find((component) => component.component === "Button" && "action" in component);
    assert.ok(button && "action" in button && button.action);
    // The first Button action in the first response, whatever its event name (the fixture's first action is view-unit).
    const action = button.action as unknown as { event: { name: string; context: unknown } };

    const expanded = app.handleEvent(threadId, { ...action.event, surfaceId: turn.surfaces[0]!.surfaceId });
    assert.equal(expanded.ok ? expanded.mode?.id : undefined, "stays", "an event carries the mode");
    assert.equal(app.getState(threadId)?.mode?.id, "stays", "a state read carries the mode");
  } finally {
    environment.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AC7: The mode survives a cold restore on the assistant path", async () => {
  // The same booking journey as assistant-cold-journey.test.ts, with the mode asserted on every response and on the state
  // read after each cold restore.
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000305";
    const step = async (label: string, run: () => Promise<GuestTurnSuccess>): Promise<GuestTurnSuccess> => {
      const response = await run();
      assert.equal(response.mode?.id, "stays", `${label}: the response carries the mode`);
      assert.equal(coldApp(f, threadId).getState(threadId)?.mode?.id, "stays", `${label}: the state read after a cold restore carries the mode`);
      return response;
    };

    const search = await step("search", async () => successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search"));
    const detail = await step("View", () => tap(f, threadId, search.surfaces[0]!, "View"));
    assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, "View opens the unit detail");
    const draft = await step("Request to Book", () => tap(f, threadId, detail.surfaces[0]!, "Request to Book"));
    assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/, "Request to Book opens the draft");
    const phoneAsk = await step("Review request", () => tap(f, threadId, draft.surfaces[0]!, "Review request"));
    assert.match(phoneAsk.surfaces[0]!.surfaceId, /:contact:phone:/, "Review asks for the phone number");

    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = await step("Save phone number", async () => successOf(await coldApp(f, threadId).handleEventAsync(threadId, {
      ...phoneSave,
      context: { ...phoneSave.context, contactValue: PHONE },
    }), "Save phone number"));
    const sent = await step("Send booking request", () => tap(f, threadId, saved.surfaces[0]!, "Send booking request"));
    const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
    f.environment.simulateOperatorAcceptance(requestId);

    const offer = coldApp(f, threadId).getState(threadId);
    assert.ok(offer, "the conversation is readable after acceptance");
    assert.equal(offer.mode?.id, "stays", "the offer state read carries the mode");
    const payment = await step("Accept offer", () => tap(f, threadId, offer.surfaces[0]!, "Accept offer"));
    assert.match(payment.surfaces[0]!.summary ?? "", /payment/i, "accepting the offer opens payment");

    const checkout = await step("Start checkout", () => tap(f, threadId, payment.surfaces[0]!, "Start checkout"));
    assert.match(checkout.surfaces[0]!.surfaceId, /:contact:email:/, "checkout asks for the contact email");
    const emailAsk = firstButtonAction(checkout.surfaces[0]!);
    const emailSaved = await step("Save email", async () => successOf(await coldApp(f, threadId).handleEventAsync(threadId, {
      ...emailAsk,
      context: { ...emailAsk.context, contactValue: "guest@example.com" },
    }), "Save email"));
    assert.match(emailSaved.surfaces[0]!.textFallback ?? "", /payment handoff ready|payment has not succeeded/i, "payment is ready to hand off");
  } finally {
    f.close();
  }
});

test("AC8: The client refuses an invalid mode", () => {
  assert.doesNotThrow(() => assertValidResponseMode(undefined), "an absent mode is allowed");
  assert.doesNotThrow(() => assertValidResponseMode(GUEST_MODES.stays), "the stays presentation is allowed");

  const starter = { label: "Explore Abuja", prompt: "I’m looking for a stay in Abuja" };
  const refused: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["a string", "x"],
    ["a number", 42],
    ["an array", []],
    ["an object with an unknown key", staysVariant((copy) => { copy.surprise = "not a field"; })],
    ["a presentation with an empty heading", staysVariant((copy) => { section(copy, "emptyState").heading = ""; })],
    ["a presentation with zero starters", staysVariant((copy) => { section(copy, "emptyState").starters = []; })],
    ["a presentation with an unknown icon", staysVariant((copy) => { section(copy, "persona").icon = "not-a-kit-icon"; })],
    ["a presentation with five starters", staysVariant((copy) => { section(copy, "emptyState").starters = [starter, starter, starter, starter, starter]; })],
  ];
  for (const [label, candidate] of refused) {
    assert.throws(() => assertValidResponseMode(candidate), /Invalid response mode/, `refuses ${label}`);
  }
});

test("AC8: the client wires its response check through assertValidResponseMode", () => {
  // The client is a browser entry (DOM and getThreadId() at module scope), so its wiring is read from source. The check
  // itself is behavioural in the test above; this only guards against the call being dropped from readGuestResponse.
  const source = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.match(source, /assertValidResponseMode\(value\.mode\);/);
  assert.match(source, /import\s*\{[^}]*\bassertValidResponseMode\b[^}]*\}\s*from\s*"\.\/response-mode\.js"/);
});
