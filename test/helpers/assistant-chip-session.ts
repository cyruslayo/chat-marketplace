import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT, criteriaSurfaceId, type GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import { createFakeShopPack } from "./fake-domain-pack.js";
import { openJourneyEnvironment } from "./assistant-recordings.js";
import { LIVE_LIKE_CLOCK, wireDatedApp, type DatedFixture } from "./guest-date-fixtures.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../../apps/local-guest/src/assistant/assistant-platform.js";

/**
 * A driver for one guest thread on the criteria strip and the assistant (issue 03 review follow-up, shared by the supersession and
 * where-chip tests). A cold driver builds a new application before every step, as a Worker request does, and loads the thread
 * first. A warm driver keeps one application and does not reload it: a page load resets the assistant undo history, so only a warm
 * driver can step back with undo (issue 03 Comments).
 *
 * The criteria key is taken from the last result, as the page does: a chip edit names the `basedOn` key of the strip it shows.
 */
export type GuestFixture = Omit<DatedFixture, "close">;

export interface ChipDriver {
  /** The application for one step (loaded first when the driver is cold). */
  step(): GuestFixture;
  /** A typed guest message. */
  typed(text: string): Promise<GuestTurnResult>;
  /** A criteria chip edit or undo. */
  chip(name: typeof CRITERIA_EDIT_EVENT | typeof CRITERIA_UNDO_EVENT, context: Record<string, unknown>): Promise<GuestTurnResult>;
  /** A client-style task event (the shell routes it to the runtime's task handler). */
  taskEvent(name: typeof TASK_START_EVENT | typeof TASK_SWITCH_EVENT, context: Record<string, unknown>): Promise<GuestTurnResult>;
  /** The open proposal's id on the runtime, or null. */
  pendingId(): string | null;
  /** The runtime's current stay facts for the thread. */
  stay(): { readonly location?: string; readonly neighbourhood?: string; readonly partySize?: number; readonly checkIn?: string };
}

export function openChipDriver(
  environment: LocalGuestEnvironment,
  model: AssistantModelClient,
  options: { readonly cold: boolean; readonly threadId: string; readonly withShopTask?: boolean },
): ChipDriver {
  const { cold, threadId } = options;
  const shop = options.withShopTask ? [createFakeShopPack()] : undefined;
  let warm: GuestFixture | undefined;
  let key: string | undefined;

  const step = (): GuestFixture => {
    if (cold) {
      const fixture = wireDatedApp(environment, model, undefined, shop);
      fixture.app.getState(threadId);
      return fixture;
    }
    warm ??= wireDatedApp(environment, model, undefined, shop);
    return warm;
  };
  const remember = (result: GuestTurnResult): GuestTurnResult => {
    if (result.ok && result.criteria?.key) key = result.criteria.key;
    return result;
  };

  return {
    step,
    typed: async (text) => remember(await step().app.handleTurn(threadId, text)),
    chip: async (name, context) => {
      assert.ok(key, "the criteria strip has a key");
      return remember(await step().app.handleEventAsync(threadId, {
        name,
        surfaceId: criteriaSurfaceId(threadId),
        sourceComponentId: "criteria-chip",
        timestamp: LIVE_LIKE_CLOCK().toISOString(),
        context: { ...context, basedOn: key },
      }));
    },
    taskEvent: (name, context) => step().app.handleEventAsync(threadId, {
      name,
      surfaceId: `thread-${threadId}:tasks`,
      sourceComponentId: "task-rail",
      timestamp: LIVE_LIKE_CLOCK().toISOString(),
      context,
    }),
    pendingId: () => step().runtime.getThread(threadId).taskState.pendingAction?.id ?? null,
    stay: () => {
      const intent = step().runtime.getThread(threadId).taskState.stayIntent;
      return { location: intent.location, neighbourhood: intent.neighbourhood, partySize: intent.partySize, checkIn: intent.checkIn };
    },
  };
}

export function assertOk(result: GuestTurnResult, label: string): void {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: ${result.code} ${result.message}`);
}

/** The proposal card a proposal turn returned. */
export function proposalCard(result: GuestTurnResult) {
  assertOk(result, "propose");
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(card, "a proposal card is returned");
  return card;
}

export function requestSent(result: GuestTurnResult): boolean {
  return result.ok && result.surfaces.some((surface) => /:request:/.test(surface.surfaceId));
}

/** A staging-like guest: no phone, as the staging Durable Object starts it. */
export function stagingGuest(): LocalGuestEnvironment {
  return openJourneyEnvironment();
}

/**
 * A phone-holding guest. Used only where a confirm of a still-valid proposal reaches the deterministic path, which needs a phone
 * (finding 9); a confirm that wrongly got through would then send the request and fail the test.
 */
export function phoneGuest(): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
}
