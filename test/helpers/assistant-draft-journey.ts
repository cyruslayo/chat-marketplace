import assert from "node:assert/strict";
import type { GuestTurnResult, GuestTurnSuccess } from "../../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { coldTurn, datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, successfulTurn, type DatedFixture, type ScriptedTurn } from "./guest-date-fixtures.js";

// Shared by the assistant Request Draft tests (ADR 0106, ADR 0080): a 2-night draft reached by the guest's journey, and the
// planner's draft changes. Every turn and event runs on a cold restore (a new application over the same store), on a fresh
// thread, with the assistant runtime enabled, the staging-like clock (27 Oct 2026) and a staging-like guest (no phone or email).

const TWO_NIGHT_TEXT = "Apartment in Lekki for 2 guests, 2 nights from 14 December 2026";
const SEARCH_TWO = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 2, guests: 2 };

export const DRAFT_JOURNEY_SCRIPT: Record<string, ScriptedTurn> = {
  [TWO_NIGHT_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 2, guests: 2 }, search: SEARCH_TWO },
  "make it 3 nights": { slots: { nights: 3 }, search: { city: "Lagos", nights: 3, guests: 2 } },
  "make it 4 nights": { slots: { nights: 4 }, search: { city: "Lagos", nights: 4, guests: 2 } },
  "make it 181 nights": { slots: { nights: 181 }, search: { city: "Lagos", nights: 181, guests: 2 } },
  "make it 9 guests": { slots: { guests: 9 }, search: { city: "Lagos", nights: 2, guests: 9 } },
  // Issue 13b (ADR 0106, 2 Nov 2026): a relative date is shown back and confirmed before any replacement is quoted.
  "make it from tomorrow": { slots: {}, search: { city: "Lagos", checkInPhrase: "tomorrow", nights: 2, guests: 2 } },
  yes: { slots: {}, search: { city: "Lagos", checkIn: "2026-10-28", nights: 2, guests: 2 } },
  no: { slots: {}, intents: [], scope: "unclear" },
  "from 3 November": { slots: { checkIn: "2026-11-03" }, search: { city: "Lagos", checkIn: "2026-11-03", nights: 2, guests: 2 } },
  "Actually, show me Ikoyi instead": { slots: { neighbourhood: "Ikoyi" }, search: { city: "Lagos", neighbourhood: "Ikoyi", checkIn: "2026-12-14", nights: 2, guests: 2 } },
};

export type Action = ReturnType<typeof firstButtonAction>;
export interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

export interface Journey {
  readonly f: DatedFixture;
  readonly threadId: string;
  readonly model: AssistantModelClient;
  readonly draftSurface: Surface;
  readonly draftId: string;
}

export function success(result: GuestTurnResult, label: string): GuestTurnSuccess {
  return successfulTurn(result, label);
}

export function rejected(result: GuestTurnResult, code: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal((result as { code: string }).code, code);
}

/** A new application over the same store, loaded as a page load does, before the event is sent (ADR 0106 cold restore). */
export function coldApp(j: Pick<Journey, "f" | "model" | "threadId">) {
  const restored = restartedDatedApp(j.f, j.model);
  restored.app.getState(j.threadId);
  return restored.app;
}

/** Every Button action on a surface, in document order. */
export function buttonActions(surface: Surface): Action[] {
  const found: Action[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const record = node as Record<string, unknown>;
    const event = (record.action as { readonly event?: { readonly name?: unknown; readonly context?: unknown } } | undefined)?.event;
    if (record.component === "Button" && event && typeof event.name === "string" && event.context !== null && typeof event.context === "object") {
      found.push({ ...firstButtonAction({ surfaceId: surface.surfaceId, a2uiMessages: [record] }), name: event.name, context: event.context as Record<string, unknown> });
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(surface.a2uiMessages);
  return found;
}

/** The Button action on a surface that sends the named event. */
export function actionNamed(surface: Surface, name: string): Action {
  const action = buttonActions(surface).find((candidate) => candidate.name === name);
  assert.ok(action, `${surface.surfaceId} has no ${name} action`);
  return { ...action, surfaceId: surface.surfaceId };
}

/** A 2-night Request Draft in Lekki, on screen, reached by the guest's journey: search, View, Request to Book (cold restore before each). */
export async function draftJourney(label: string): Promise<Journey> {
  const model = scriptedPlanner(DRAFT_JOURNEY_SCRIPT).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const threadId = `g-d13a${Buffer.from(label).toString("hex")}0001`;
  const search = success(await coldTurn(f, threadId, TWO_NIGHT_TEXT, model), "search");
  const detail = success(await coldApp({ f, model, threadId }).handleEventAsync(threadId, firstButtonAction(search.surfaces[0]!)), "View");
  assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/);
  const draft = success(await coldApp({ f, model, threadId }).handleEventAsync(threadId, firstButtonAction(detail.surfaces[0]!)), "Request to Book");
  const draftSurface = draft.surfaces[0]!;
  assert.match(draftSurface.surfaceId, /:request:draft:/);
  return { f, threadId, model, draftSurface, draftId: draftSurface.surfaceId.split(":").at(-1)! };
}

/** The planner's "make it N nights" or party change, on a cold restore. */
export async function changeDraft(j: Journey, text: string): Promise<GuestTurnResult> {
  return coldTurn(j.f, j.threadId, text, j.model);
}

/** A guest event sent after a cold restore. */
export function event(j: Journey, action: Action): Promise<GuestTurnResult> {
  return coldApp(j).handleEventAsync(j.threadId, action);
}

export function replacementSurface(result: GuestTurnSuccess): Surface {
  const surface = result.surfaces[0];
  assert.ok(surface, "a replacement surface is shown");
  assert.match(surface.surfaceId, /:request:replacement:/);
  return surface;
}
