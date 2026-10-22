import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";

function createRuntime(demo: boolean, model: ScriptedAssistantModel) {
  const directory = mkdtempSync(join(tmpdir(), "demo-extended-assistant-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite"), demo, deployment: demo ? "staging" : "production" });
  return {
    directory,
    environment,
    runtime: new AssistantRuntime(environment, model),
    close() { environment.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

function addExtendedTerms(environment: LocalGuestEnvironment, version: string): void {
  const unit = environment.unitRepository.findAll()[0]!;
  environment.unitRepository.save({
    ...unit,
    extendedStay: {
      optedIn: true,
      monthlyAgreedAmounts: { accommodationKobo: 15_000_000, mandatoryChargesKobo: 500_000, version },
      utilitiesAndServicing: { powerAndGeneratorFuelIncluded: true, waterIncluded: true, internetIncluded: true, cleaningIncluded: true, cleaningFrequency: "weekly" },
    },
  });
}

test("Staging demo Assistant tools expose and execute one 30-night stay; non-demo tools remain limited to 14 nights", async () => {
  let offeredMaximum = 0;
  let stayRef = "";
  const model = new ScriptedAssistantModel([
    (request) => {
      const latestUser = [...request.history].reverse().find((step) => step.role === "user");
      if (request.history.at(-1)?.role === "user" && latestUser?.text.toLowerCase().includes("open")) return { toolCalls: [{ id: "open-30-night", name: "get_unit_details", args: { stayRef } }] };
      if (request.history.at(-1)?.role === "user" && latestUser?.text.toLowerCase().includes("book")) return { toolCalls: [{ id: "draft-30-night", name: "prepare_request_draft", args: { stayRef, nights: 30, guests: 2 } }] };
      if (request.history.at(-1)?.role === "user") {
        const searchTool = request.tools.find((tool) => tool.name === "search_stays");
        const schema = searchTool?.parametersSchema as { readonly properties?: { readonly nights?: { readonly maximum?: number } } } | undefined;
        offeredMaximum = schema?.properties?.nights?.maximum ?? 0;
        return { toolCalls: [{ id: "search-30-night", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 30, guests: 2 } }] };
      }
      return { text: "I checked the requested stay." };
    },
  ]);
  const demo = createRuntime(true, model);
  try {
    addExtendedTerms(demo.environment, "assistant-month-v1");
    const search = await demo.runtime.handleTurn("g-assistant-extended", "I need an apartment in Ikoyi for 30 nights for two guests.");
    assert.equal(offeredMaximum, 180, "ADR 0105 (amended): the staging demo advertises up to 180 nights");
    assert.equal(search.surfaces?.length, 1);
    stayRef = demo.runtime.getThread("g-assistant-extended").taskState.shortlist[0]!.stayRef;
    await demo.runtime.handleTurn("g-assistant-extended", "Open the first stay.");
    const draft = await demo.runtime.handleTurn("g-assistant-extended", "Book the first stay for 30 nights.");
    const thread = demo.runtime.getThread("g-assistant-extended");
    assert.ok(thread.taskState.currentDraftId);
    assert.equal(draft.surfaces?.[0]?.surfaceId.includes(":request:draft:"), true);
  } finally {
    demo.close();
  }

  for (const nights of [15, 29, 181]) {
    const badModel = new ScriptedAssistantModel([
      (request) => {
        if (request.history.at(-1)?.role === "user") return { toolCalls: [{ id: `search-${nights}`, name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights, guests: 2 } }] };
        return { text: "The requested duration is not available." };
      },
    ]);
    const invalid = createRuntime(true, badModel);
    try {
      addExtendedTerms(invalid.environment, `assistant-invalid-${nights}`);
      const response = await invalid.runtime.handleTurn(`g-assistant-invalid-${nights}`, `I need an apartment in Ikoyi for ${nights} nights for two guests.`);
      assert.equal(response.surfaces?.length ?? 0, 0, `${nights} nights must not create a discovery surface`);
      assert.equal(invalid.runtime.getThread(`g-assistant-invalid-${nights}`).taskState.shortlist.length, 0, `${nights} nights must not create an authoritative shortlist`);
    } finally {
      invalid.close();
    }
  }

  const shortStayModel = new ScriptedAssistantModel();
  const shortStay = createRuntime(false, shortStayModel);
  try {
    const tools = createShortletAssistantPack(shortStay.environment).toolsForState({ goal: null, stayIntent: {}, shortlist: [] });
    const searchTool = tools.find((tool) => tool.name === "search_stays");
    const schema = searchTool?.parametersSchema as { readonly properties?: { readonly nights?: { readonly maximum?: number } } } | undefined;
    assert.equal(schema?.properties?.nights?.maximum, 14);
  } finally {
    shortStay.close();
  }
});
