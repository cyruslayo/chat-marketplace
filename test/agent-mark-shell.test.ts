import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as guestKit from "../apps/local-guest/src/guest-kit.js";
import { renderGuestShellHtml, renderNoScriptConversationHtml } from "../apps/local-guest/src/guest-server.js";
import { GUEST_MODES, validateModePresentation } from "../apps/web-agent/src/guest-content.js";
import { ICON_NAMES } from "../apps/web/src/ui-kit.js";
import type { AgentMarkEvent, AgentMarkState } from "../apps/local-guest/src/agent-mark-state.js";

/*
 * Issue 01b of the agent-modes effort: the Agent Mark for the single stays mode (ADR 0107 decision 9, ADR 0076, ADR 0078,
 * ADR 0080, ADR 0106). These tests are written before the implementation. The seams below are the contract the
 * implementation agents follow.
 *
 * SEAMS
 * - apps/web/src/ui-kit.ts: ICON_PATHS gains "stays-mark" (a roof-like silhouette, currentColor, aria-hidden). ICON_NAMES
 *   lists it, so validateModePresentation accepts it.
 * - apps/web-agent/src/guest-content.ts: GUEST_MODES.stays.persona.icon === "stays-mark".
 * - apps/local-guest/src/guest-kit.ts: export function agentMarkHtml(mode, placement, state = "idle"): string.
 *     placement: "hero" | "appbar" | "dock". The root is <span class="agent-mark" data-agent-mark="<placement>"
 *     data-agent-state="<state>" aria-hidden="true"> holding icon(mode.persona.icon). The "human" state adds
 *     data-agent-badge="person" and shows the person badge instead of the stays silhouette.
 * - apps/local-guest/src/agent-mark-state.ts: exports AGENT_MARK_STATES (the nine states), the types AgentMarkState,
 *     AgentMarkPlacement and AgentMarkEvent, and nextAgentMarkState(current, event). Events are
 *     { type: "turn-started" }, { type: "reply-landed" }, { type: "response-settled" },
 *     { type: "turn-refused", code: "quota_refusal" | "CONCIERGE_UNAVAILABLE" },
 *     { type: "composer-changed", focusedWithText: boolean }.
 * - guest shell (renderGuestShellHtml): the hero mark sits inside #empty-state before h2#empty-state-heading; the app-bar
 *   mark sits inside header.ui-appbar before the h1 title.
 */

/** The seam module is loaded inside the one test that needs it, so the other criteria still run and report their own failures. */
type MarkModule = typeof import("../apps/local-guest/src/agent-mark-state.js");
async function loadMarkState(): Promise<MarkModule> {
  return import("../apps/local-guest/src/agent-mark-state.js");
}

/** Every state the type may name, in the order the ADR lists them. */
const ALL_STATES: readonly AgentMarkState[] = ["idle", "listening", "thinking", "working", "responding", "suggesting", "switching", "resting", "human"];
/** States that no event produces in this slice: `human` waits for a takeover signal (ADR 0076), `working` has no signal yet, and `suggesting` and `switching` wait for slice 4b. */
const NEVER_PRODUCED: readonly AgentMarkState[] = ["human", "working", "suggesting", "switching"];

const EVENTS: readonly AgentMarkEvent[] = [
  { type: "turn-started" },
  { type: "reply-landed" },
  { type: "response-settled" },
  { type: "turn-refused", code: "quota_refusal" },
  { type: "turn-refused", code: "CONCIERGE_UNAVAILABLE" },
  { type: "composer-changed", focusedWithText: true },
  { type: "composer-changed", focusedWithText: false },
];

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("AC1: The shell shows the stays mark in the hero and in the app bar", () => {
  const html = renderGuestShellHtml();
  const hero = guestKit.agentMarkHtml(GUEST_MODES.stays, "hero");
  const appBar = guestKit.agentMarkHtml(GUEST_MODES.stays, "appbar");
  assert.match(hero, /aria-hidden="true"/, "the hero mark is aria-hidden");
  assert.match(appBar, /aria-hidden="true"/, "the app-bar mark is aria-hidden");
  assert.ok(html.includes(hero), "the shell renders the hero mark from agentMarkHtml");
  assert.ok(html.includes(appBar), "the shell renders the app-bar mark from agentMarkHtml");

  const emptyStart = html.indexOf('<section id="empty-state"');
  const emptyHeading = html.indexOf('<h2 id="empty-state-heading">');
  const heroAt = html.indexOf(hero);
  assert.ok(emptyStart >= 0 && heroAt > emptyStart && heroAt < emptyHeading, "the hero mark sits in the empty state above its heading");

  const barStart = html.indexOf('<header class="ui-appbar">');
  const bar = html.slice(barStart, html.indexOf("</header>", barStart));
  const barMarkAt = bar.indexOf(appBar);
  assert.ok(barMarkAt >= 0, "the app-bar mark sits inside header.ui-appbar");
  assert.ok(barMarkAt < bar.indexOf("<h1>"), "the app-bar mark sits before the title");
  const beforeMark = bar.slice(0, barMarkAt);
  assert.equal(count(beforeMark, "<button"), count(beforeMark, "</button>"), "no button wraps the app-bar mark");
  assert.doesNotMatch(appBar, /<(button|a)[\s>]/, "the app-bar mark is not a button or a link");
  assert.doesNotMatch(appBar, /role="button"/, "the app-bar mark is not given a button role");
});

test("AC2: Each mark state comes from an existing signal", async () => {
  const mark = await loadMarkState();
  const next = mark.nextAgentMarkState;

  assert.equal(next("idle", { type: "turn-started" }), "thinking", "an in-flight turn from idle gives thinking");
  assert.equal(next("listening", { type: "turn-started" }), "thinking", "an in-flight turn from listening gives thinking");
  assert.equal(next("thinking", { type: "reply-landed" }), "responding", "a reply gives responding");
  assert.equal(next("responding", { type: "response-settled" }), "idle", "the reply pop settles to idle");

  for (const code of ["quota_refusal", "CONCIERGE_UNAVAILABLE"] as const) {
    for (const from of ALL_STATES.filter((state) => state !== "human")) {
      assert.equal(next(from, { type: "turn-refused", code }), "resting", `${code} from ${from} gives resting`);
    }
  }

  assert.equal(next("idle", { type: "composer-changed", focusedWithText: true }), "listening", "a focused composer with text gives listening");
  assert.equal(next("listening", { type: "composer-changed", focusedWithText: false }), "idle", "an emptied composer returns to idle");
});

test("AC2: No event sequence yields human, working, suggesting or switching", async () => {
  const mark = await loadMarkState();
  assert.deepEqual([...mark.AGENT_MARK_STATES].sort(), [...ALL_STATES].sort(), "the type names the nine closed states");

  // Breadth-first over every event sequence up to depth 4 from idle: the reachable set must avoid the never-produced states.
  const reached = new Set<AgentMarkState>(["idle"]);
  let frontier: readonly AgentMarkState[] = ["idle"];
  for (let depth = 0; depth < 4; depth += 1) {
    const grown: AgentMarkState[] = [];
    for (const state of frontier) {
      for (const event of EVENTS) {
        const after = mark.nextAgentMarkState(state, event);
        reached.add(after);
        grown.push(after);
      }
    }
    frontier = grown;
  }
  for (const state of NEVER_PRODUCED) {
    assert.equal(reached.has(state), false, `no event sequence yields ${state}`);
  }

  const source = readFileSync(new URL("../apps/local-guest/src/agent-mark-state.ts", import.meta.url), "utf8");
  assert.match(source, /ADR 0076/, "the state map cites ADR 0076 where a takeover signal must set human");
});

test("AC6: A mark in the human state shows the person badge and never animates", () => {
  const human = guestKit.agentMarkHtml(GUEST_MODES.stays, "hero", "human");
  assert.match(human, /data-agent-state="human"/, "the mark is in the human state");
  assert.match(human, /data-agent-badge="person"/, "the mark shows the person badge");

  const css = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
  const styles = `${css}\n${renderGuestShellHtml()}`;
  const rules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" }));

  const humanRules = rules.filter((rule) => rule.selector.includes('data-agent-state="human"'));
  assert.ok(humanRules.length > 0, "the kit styles the human state");
  for (const rule of humanRules) {
    assert.doesNotMatch(rule.body, /animation|transition/, `the human rule has no animation: ${rule.selector}`);
  }

  // Every animated mark rule must name one specific non-human state, so no animation can reach the human mark.
  const animatedMarkRules = rules.filter((rule) => /animation/.test(rule.body) && /agent-mark/.test(rule.selector));
  for (const rule of animatedMarkRules) {
    assert.match(rule.selector, /data-agent-state="[a-z]+"/, `an animated mark rule names its state: ${rule.selector}`);
    assert.doesNotMatch(rule.selector, /data-agent-state="human"/, `no animated mark rule targets human: ${rule.selector}`);
    assert.doesNotMatch(rule.selector, /\[data-agent-state\]/, `no animated mark rule matches every state: ${rule.selector}`);
  }
});

test("The stays persona uses the stays-mark icon, which the kit and presentation validation accept", () => {
  const kitNames: readonly string[] = ICON_NAMES;
  assert.ok(kitNames.includes("stays-mark"), "the kit icon set names stays-mark");
  assert.equal(GUEST_MODES.stays.persona.icon, "stays-mark", "the stays presentation uses stays-mark");

  const copy = JSON.parse(JSON.stringify(GUEST_MODES.stays)) as { persona: { icon: string } };
  copy.persona.icon = "stays-mark";
  assert.equal(typeof validateModePresentation(copy), "object", "validateModePresentation accepts stays-mark");
});

test("AC8: The server-rendered shell shows both marks in the idle state without a client script", async () => {
  const html = renderGuestShellHtml();
  const hero = guestKit.agentMarkHtml(GUEST_MODES.stays, "hero", "idle");
  const appBar = guestKit.agentMarkHtml(GUEST_MODES.stays, "appbar", "idle");
  assert.match(hero, /data-agent-state="idle"/, "the hero mark is idle in the server markup");
  assert.match(appBar, /data-agent-state="idle"/, "the app-bar mark is idle in the server markup");
  assert.ok(html.includes(hero), "the hero mark is in the server-rendered shell");
  assert.ok(html.includes(appBar), "the app-bar mark is in the server-rendered shell");
  // Both marks are in the markup before the client script loads, so they show with JavaScript off.
  assert.ok(html.indexOf(hero) < html.indexOf('<script src="/client.js"'), "the hero mark precedes the client script");
  assert.ok(html.indexOf(appBar) < html.indexOf('<script src="/client.js"'), "the app-bar mark precedes the client script");

  // The no-JS conversation page is a different surface: it has no empty state and gains no marks (issue 01b, AC8).
  const page = renderNoScriptConversationHtml({ threadId: "g-agent-mark", timeline: [], surfaces: [] });
  assert.equal(page.includes("data-agent-mark"), false, "the /conversation page renders no agent marks");
});
