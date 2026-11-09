import assert from "node:assert/strict";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";

/** How long the held turn stays in flight in the real-Chrome agent-mark tests (issue 01b, AC4 and AC7). */
export const HELD_TURN_MS = 7_000;

/** The reply the held turn returns once the hold ends. Synthetic copy for test use only. */
const HELD_REPLY = "Here is what I found.";

/**
 * A scripted model whose user-facing turn waits `holdMs` before it answers. The first planner call of each turn is held, and the
 * scope classifier is not, so only the turn itself stays in flight, as a slow real turn would.
 */
export function heldTurnModel(holdMs: number): AssistantModelClient {
  const inner = new ScriptedAssistantModel([
    (request: AssistantModelRequest): AssistantModelResponse | null => {
      const last = request.history.at(-1);
      return last?.role === "user" ? { text: HELD_REPLY } : null;
    },
  ]);
  return {
    async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
      // The planner's first call of a turn is structured (assistant_reply_plan), so the hold keys on the turn's first step, not on the
      // absence of structuredOutput. The scope classifier (concierge_scope) is not held.
      const startsTurn = request.history.at(-1)?.role === "user";
      if (startsTurn && request.structuredOutput?.name !== "concierge_scope") {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, holdMs);
        });
      }
      return inner.generate(request);
    },
  };
}

/** Starts an assistant-offline guest server whose turns are held in flight, the same way the task-rail fixture starts one. */
export async function startHeldTurnServer(holdMs: number = HELD_TURN_MS) {
  const server = startLocalGuestServer({
    conciergeMode: "assistant-offline",
    modelClient: heldTurnModel(holdMs),
    port: 0,
  });
  const base = `http://127.0.0.1:${await server.listen()}`;
  const home = await fetch(base);
  const cookie = home.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  await home.text();
  return {
    server,
    base,
    cookie,
    close: async () => {
      await server.close();
    },
  };
}
