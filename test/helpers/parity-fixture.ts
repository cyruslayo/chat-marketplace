import { LocalGuestApp, type GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./guest-date-fixtures.js";

/**
 * Issue 16 (ADR 0080, ADR 0106): one guest journey run through the deterministic concierge and through the assistant. Both paths
 * share this fixture: the staging clock (27 Oct 2026), a staging-like guest with no seeded contact, a fresh environment per path,
 * and a cold restore (a new application over the same store) before every event. Rows never name a path; the comparison is here.
 */

/** One guest turn: typed text, or a tap on the first button of the last surface the guest was shown. */
export type ParityTurn = { readonly text: string } | { readonly tap: true; readonly context?: Readonly<Record<string, unknown>> };

/** What a row must give on each path after a turn: the filters the guest sees, and the kinds of surface or reply shown. */
export interface ParityStep {
  readonly kinds: readonly string[];
  readonly filters: Record<string, unknown>;
}

export type ParityPath = "deterministic" | "assistant";

/** The surface kind a surface id names (the same closed set the stage map uses). */
export function surfaceKind(surfaceId: string): string {
  if (surfaceId.includes(":discovery:")) return "discovery";
  if (surfaceId.includes(":unit:")) return "unit";
  if (surfaceId.includes(":request:replacement:")) return "replacement";
  if (surfaceId.includes(":request:review:")) return "review";
  if (surfaceId.includes(":request:draft:")) return "draft";
  if (surfaceId.includes(":request:")) return "request";
  if (surfaceId.includes(":offer:")) return "offer";
  if (surfaceId.includes(":payment:")) return "payment";
  if (surfaceId.includes(":booking:")) return "booking";
  if (surfaceId.includes(":contact:phone:")) return "contact-phone";
  if (surfaceId.includes(":contact:email:")) return "contact-email";
  return "other";
}

function kindsOf(result: GuestTurnResult): string[] {
  if (!result.ok) return [`error:${result.code}`];
  return result.surfaces.map((surface) => surfaceKind(surface.surfaceId));
}

/** The filters the guest sees in the criteria strip; the same projection on both paths. */
function filtersOf(state: { readonly criteria?: unknown } | undefined): Record<string, unknown> {
  const criteria = (state?.criteria ?? {}) as Record<string, unknown>;
  return { where: criteria.where ?? null, when: criteria.when ?? null, guests: criteria.guests ?? null, budget: criteria.budget ?? null };
}

/** Runs a row's turns on one path and returns the observed step after each turn. */
export async function runParityPath(path: ParityPath, turns: readonly ParityTurn[], script: Readonly<Record<string, ScriptedTurn>>, threadId: string, liveModel?: AssistantModelClient): Promise<ParityStep[]> {
  // The scripted planner answers offline; the owner-run live script passes its staging client instead.
  const model = liveModel ?? scriptedPlanner(script).client;
  const fixture: DatedFixture = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  // Every event is a new application over the same store (cold restore). The deterministic path has no assistant runtime.
  const appFor = (): LocalGuestApp => (path === "assistant" ? restartedDatedApp(fixture, model).app : new LocalGuestApp(fixture.environment));
  const steps: ParityStep[] = [];
  let lastSurface: GuestTurnResult | undefined;
  try {
    for (const turn of turns) {
      const app = appFor();
      app.getState(threadId);
      let result: GuestTurnResult;
      if ("text" in turn) {
        result = await app.handleTurn(threadId, turn.text);
      } else {
        const surface = lastSurface?.ok ? lastSurface.surfaces.at(-1) : undefined;
        if (surface === undefined) throw new Error("a tap needs a surface the guest was shown");
        // A contact step's Save carries the value the guest typed (the placeholder number on the staging guest).
        const action = firstButtonAction(surface);
        result = await app.handleEventAsync(threadId, "context" in turn && turn.context !== undefined ? { ...action, context: { ...action.context, ...turn.context } } : action);
      }
      lastSurface = result;
      steps.push({ kinds: kindsOf(result), filters: filtersOf(appFor().getState(threadId)) });
    }
    return steps;
  } finally {
    fixture.close();
  }
}
