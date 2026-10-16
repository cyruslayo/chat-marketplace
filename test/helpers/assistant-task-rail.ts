import assert from "node:assert/strict";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./fake-domain-pack.js";

/** The scripted model drives the shell into a two-task state: shortlet search, then a shop task. */
export function taskRailModel(): ScriptedAssistantModel {
  return new ScriptedAssistantModel([
    (request) => {
      const last = request.history.at(-1);
      if (last?.role === "user" && /ikoyi/i.test(last.text)) {
        return { toolCalls: [{ id: "search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 4, guests: 2 } }] };
      }
      if (last?.role === "user" && /new task/i.test(last.text)) {
        return { toolCalls: [{ id: "start", name: "start_task", args: { domain: "shop" } }] };
      }
      if (last?.role === "tool_results") return { text: "Done." };
      return null;
    },
  ]);
}

/** Starts an assistant-offline guest server with a second (fake shop) domain pack registered. */
export async function startTaskRailServer() {
  const server = startLocalGuestServer({
    conciergeMode: "assistant-offline",
    modelClient: taskRailModel(),
    additionalPacks: [createFakeShopPack()],
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
