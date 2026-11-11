import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../../apps/local-guest/src/shortlet-app.js";
import type { GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { ShortletAssistantRuntime } from "./assistant-runtime-host.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./fake-domain-pack.js";
import { LIVE_LIKE_CLOCK, STAGING_GUEST_CONFIG } from "./guest-date-fixtures.js";
import { STAY_SEARCH, STAY_TEXT } from "./assistant-cold-journey-harness.js";

/**
 * The stays search dated as the staging journey writes it, and the shop start from "new task". Shared by the issue 03c tests
 * (the search needs guest-authored dates, which the shared stay text carries).
 */
export function modeScriptModel(): ScriptedAssistantModel {
  return new ScriptedAssistantModel([
    (request) => {
      const last = request.history.at(-1);
      if (last?.role === "user" && last.text === STAY_TEXT) return { toolCalls: [{ id: "search", name: "search_stays", args: STAY_SEARCH }] };
      if (last?.role === "user" && /new task/i.test(last.text)) return { toolCalls: [{ id: "start", name: "start_task", args: { domain: "shop" } }] };
      if (last?.role === "tool_results") return { text: "Done." };
      return null;
    },
  ]);
}

// Issue 03c: a staging-like application (assistant runtime enabled, clock 27 Oct 2026, no seeded phone or email) with the fake
// shop pack registered, opened over one SQLite file. `coldModeApp` is a new application over the same store, as each Worker
// request is (ADR 0106). The fake pack is the only second domain, so the mode switch is a real shop-versus-stays change.

export interface ColdModeApp {
  readonly app: LocalGuestApp;
  readonly runtime: ShortletAssistantRuntime;
  /** The store the application reads, for tests that rewrite a stored projection (a legacy or invalid task list). */
  readonly environment: LocalGuestEnvironment;
  close(): void;
}

export function coldModeApp(databasePath: string, model: AssistantModelClient): ColdModeApp {
  const environment = LocalGuestEnvironment.openNode({ databasePath, clock: LIVE_LIKE_CLOCK, ...STAGING_GUEST_CONFIG });
  const runtime = new ShortletAssistantRuntime(environment, model, { additionalPacks: [createFakeShopPack()] });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime });
  return { app, runtime, environment, close: () => environment.close() };
}

/** Rewrites the stored thread projection in place, as a legacy or tampered store would hold it (no other field changes). */
export function rewriteStoredProjection(environment: LocalGuestEnvironment, threadId: string, mutate: (projection: Record<string, unknown>) => void): void {
  const record = environment.interactionStore.findThread(threadId);
  if (!record) throw new Error("the thread is stored before it is rewritten");
  const projection = JSON.parse(record.threadJson) as Record<string, unknown>;
  mutate(projection);
  environment.interactionStore.saveThread({ ...record, threadJson: JSON.stringify(projection) });
}

/** One guest message on a cold restore: the state read a page load makes runs first, then the turn. */
export async function coldModeTurn(databasePath: string, model: AssistantModelClient, threadId: string, text: string): Promise<GuestTurnResult> {
  const cold = coldModeApp(databasePath, model);
  try {
    cold.app.getState(threadId);
    return await cold.app.handleTurn(threadId, text);
  } finally {
    cold.close();
  }
}
