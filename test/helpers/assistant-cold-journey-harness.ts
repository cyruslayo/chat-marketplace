import assert from "node:assert/strict";
import type { GuestTurnResult, GuestTurnSuccess } from "../../apps/local-guest/src/shortlet-app.js";
import { type DatedFixture, firstButtonAction, restartedDatedApp, scriptedPlanner } from "./guest-date-fixtures.js";

// Shared by the assistant cold-journey tests: the booking script, the staging-like phone and the cold-restore driver.
// Every event goes to a NEW application over the same store, as each Worker request does (ADR 0106).

export const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
export const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
export const PHONE = "+234 801 234 5678";
export const SCRIPT = {
  [STAY_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: STAY_SEARCH },
};

export function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

export interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

/** A new application over the same store, loaded as the browser's page load does, before the event is sent. */
export function coldApp(f: DatedFixture, threadId: string) {
  const restored = restartedDatedApp(f, scriptedPlanner({}).client);
  restored.app.getState(threadId);
  return restored.app;
}

/** The first Button action on a surface, sent after a cold restore. */
export async function tap(f: DatedFixture, threadId: string, surface: Surface, label: string): Promise<GuestTurnSuccess> {
  return successOf(await coldApp(f, threadId).handleEventAsync(threadId, firstButtonAction(surface)), label);
}
