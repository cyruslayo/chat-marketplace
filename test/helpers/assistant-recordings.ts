import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import type { GuestSurfacePayload, GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import {
  ASSISTANT_RECORDING_FORMAT,
  ReplayModelClient,
  type RecordedExchange,
} from "../../apps/local-guest/src/assistant/assistant-recording.js";
import { createFakeShopPack } from "./fake-domain-pack.js";
import { withProviderAttemptHook } from "./assistant-attempt-model.js";
import { LIVE_LIKE_CLOCK, STAGING_GUEST_CONFIG, firstButtonAction, wireDatedApp } from "./guest-date-fixtures.js";

/**
 * Shared recorded-journey code for issue 03: the four named journeys, the cold-restore runner that drives them, the
 * turn-output projection that recordings store and replays compare, the intended-outcome guard the recorder applies, and
 * the loader for committed recordings. All data is synthetic (ADR 0075): placeholder stays, dates on the staging-like clock
 * and no personal details.
 */

export const RECORDINGS_DIRECTORY = resolve(fileURLToPath(new URL("../fixtures/assistant-recordings/", import.meta.url)));

/** The planner's answer to one guest text: a tool call, or the typed clarification reply (ADR 0106). */
export type PlannerAnswer = { readonly tool: string; readonly args: Readonly<Record<string, unknown>> } | "clarify_stay";

/**
 * One step of a journey. A typed text (`text`) goes through the runtime's own path; `cancel` marks a typed cancellation that
 * must settle deterministically; `button` sends the confirm button of the pending-action surface an earlier turn (`ofTurn`,
 * zero-based) returned, and `expect` names the closed code the refusal must carry.
 */
export interface RecordedGuestStep {
  readonly text: string;
  /** Omitted when the runtime settles the text without the planner (a deterministic confirmation or cancellation). */
  readonly planner?: PlannerAnswer;
  readonly cancel?: true;
  readonly button?: { readonly ofTurn: number; readonly expect?: string };
}

export interface RecordedJourneyDefinition {
  readonly name: string;
  /** The guest thread id (`g-` plus hex, THREAD_ID_PATTERN). Every surface id carries it, so a replay must reuse it. */
  readonly threadId: string;
  readonly description: string;
  /** Registers the fake shop pack, so a task switch is offered (the planner gets `start_task`). */
  readonly withSecondDomain: boolean;
  readonly guestTurns: readonly RecordedGuestStep[];
}

const SEARCH_IKOYI = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-12-14", nights: 4, guests: 2 };
const SEARCH_LEKKI = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 4, guests: 2 };
const PROPOSE_REQUEST = { tool: "propose_request_to_book", args: { stayRef: "stay-1" } } as const;

export const CANCEL_COPY = "Action cancelled. Let me know how else I can help.";

export const RECORDED_JOURNEYS: readonly RecordedJourneyDefinition[] = [
  {
    name: "search-refinement-request-draft",
    threadId: "g-d1a0000401",
    description: "Search, refine the search, open the first stay and prepare a non-submitting Request Draft.",
    withSecondDomain: false,
    guestTurns: [
      { text: "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026", planner: { tool: "search_stays", args: SEARCH_IKOYI } },
      { text: "Actually Lekki, same dates", planner: { tool: "search_stays", args: SEARCH_LEKKI } },
      { text: "Open the first one.", planner: { tool: "get_unit_details", args: { stayRef: "stay-1" } } },
      { text: "I want to book the first one.", planner: { tool: "prepare_request_draft", args: { stayRef: "stay-1", nights: 4, guests: 2 } } },
    ],
  },
  {
    name: "missing-information-clarification",
    threadId: "g-d1a0000402",
    description: "A vague search is clarified by the planner, then completed by the guest's answer with its dates.",
    withSecondDomain: false,
    guestTurns: [
      { text: "I want somewhere in Ikoyi", planner: "clarify_stay" },
      { text: "Four nights for two people, from 14 December 2026", planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    ],
  },
  {
    name: "confirmation-cancelled",
    threadId: "g-d1a0000403",
    description: "A Booking Request is proposed for confirmation and the guest types a cancellation; the pending action is cleared and nothing is sent.",
    withSecondDomain: false,
    guestTurns: [
      { text: "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026", planner: { tool: "search_stays", args: SEARCH_IKOYI } },
      { text: "Request the first one.", planner: PROPOSE_REQUEST },
      { text: "No, cancel that.", cancel: true },
    ],
  },
  {
    name: "cancel-after-task-switch",
    threadId: "g-d1a0000404",
    description: "A Booking Request awaits confirmation, the guest switches to another domain, and the guest then types a cancellation: the open Booking Request is cancelled, not sent.",
    withSecondDomain: true,
    guestTurns: [
      { text: "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026", planner: { tool: "search_stays", args: SEARCH_IKOYI } },
      { text: "Request the first one.", planner: PROPOSE_REQUEST },
      { text: "Start a new task in shop", planner: { tool: "start_task", args: { domain: "shop" } } },
      { text: "No, cancel that.", cancel: true },
    ],
  },
];

/** The journey's recording, as committed under `test/fixtures/assistant-recordings/`. Local synthetic data only. */
export interface AssistantJourneyRecording {
  readonly format: typeof ASSISTANT_RECORDING_FORMAT;
  readonly journey: string;
  readonly description: string;
  readonly clock: string;
  readonly source: string;
  readonly exchanges: readonly RecordedExchange[];
  readonly turns: readonly JourneyTurnOutput[];
}

/** One guest turn's observable output: what a replay must reproduce exactly. Component types come from A2UI, not Weaver. */
export interface JourneyTurnOutput {
  readonly guestText: string;
  readonly ok: boolean;
  readonly code?: string;
  /** The control outcome the runtime reported for a typed turn, when it reported one. */
  readonly controlOutcome?: string;
  readonly messages: readonly string[];
  readonly surfaces: readonly { readonly surfaceId: string; readonly componentTypes: readonly string[] }[];
  readonly tasks: readonly { readonly taskId: string; readonly domain: string; readonly status: string; readonly active: boolean }[];
}

/** Every `component` name in a surface's A2UI messages, in order, without duplicates. */
export function componentTypesOf(surface: GuestSurfacePayload): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.component === "string" && !found.includes(record.component)) found.push(record.component);
    Object.values(record).forEach(visit);
  };
  visit(surface.a2uiMessages);
  return found;
}

export function outputOf(guestText: string, result: GuestTurnResult): JourneyTurnOutput {
  if (!result.ok) return { guestText, ok: false, code: result.code, messages: [], surfaces: [], tasks: [] };
  return {
    guestText,
    ok: true,
    ...(result.assistantControlOutcome ? { controlOutcome: result.assistantControlOutcome } : {}),
    messages: [...result.messages],
    surfaces: result.surfaces.map((surface) => ({ surfaceId: surface.surfaceId, componentTypes: componentTypesOf(surface) })),
    tasks: (result.tasks ?? []).map((task) => ({ taskId: task.taskId, domain: task.domain, status: task.status, active: task.active })),
  };
}

/** The staging-like local environment: the given store (in-memory by default), staging clock, guest with no phone or email. */
export function openJourneyEnvironment(databasePath: string = ":memory:"): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath, clock: LIVE_LIKE_CLOCK, ...STAGING_GUEST_CONFIG });
}

/** Typed reply plan for a finished tool round (ADR 0106): the kind follows the tool that succeeded. */
function replyAfter(results: readonly { readonly name: string }[]): AssistantModelResponse {
  const name = results[0]?.name ?? "";
  const kind = name === "search_stays" ? "show_results"
    : name === "get_unit_details" ? "show_details"
      : "propose_action";
  return { text: JSON.stringify({ kind, references: [name] }) };
}

/**
 * The classifier's advisory slots come from the journey's planned search, as a live classifier would extract them from the
 * guest's own text. Every other verdict is the scripted one.
 */
class ScopeSlotsModel implements AssistantModelClient {
  readonly #definition: RecordedJourneyDefinition;
  readonly #inner: AssistantModelClient;

  constructor(definition: RecordedJourneyDefinition, inner: AssistantModelClient) {
    this.#definition = definition;
    this.#inner = inner;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const response = await this.#inner.generate(request);
    return request.structuredOutput?.name === "concierge_scope" ? this.#scopeVerdict(request, response) : response;
  }

  #scopeVerdict(request: AssistantModelRequest, response: AssistantModelResponse): AssistantModelResponse {
    const last = request.history.at(-1);
    if (last?.role !== "user") return response;
    const message = (JSON.parse(last.text) as { readonly message?: unknown }).message;
    const turn = this.#definition.guestTurns.find((candidate) => candidate.text === message);
    if (turn?.planner === undefined || turn.planner === "clarify_stay" || turn.planner.tool !== "search_stays") return response;
    const verdict = JSON.parse(response.text ?? "{}") as { slots: Record<string, unknown> };
    const args = turn.planner.args;
    return { ...response, text: JSON.stringify({ ...verdict, slots: { ...verdict.slots, city: args.city, neighbourhood: args.neighbourhood, checkIn: args.checkIn, nights: args.nights, guests: args.guests } }) };
  }
}

/**
 * The offline model for a journey, behind the provider contract. The scope classifier and the deterministic confirmations
 * come from the scripted model; each planner answer is the one the journey definition names, so no keyword heuristic
 * decides a recorded turn.
 */
export function journeyScriptedModel(definition: RecordedJourneyDefinition): AssistantModelClient {
  const scripted = new ScriptedAssistantModel([
    (request: AssistantModelRequest) => {
      const last = request.history.at(-1);
      if (last?.role === "tool_results") return replyAfter(last.results);
      if (last?.role !== "user") return null;
      const turn = definition.guestTurns.find((candidate) => candidate.text === last.text);
      if (!turn?.planner) return null;
      if (turn.planner === "clarify_stay") return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
      return { toolCalls: [{ id: `call-${request.history.length}`, name: turn.planner.tool, args: { ...turn.planner.args } }] };
    },
  ]);
  return withProviderAttemptHook(new ScopeSlotsModel(definition, scripted));
}

/**
 * Runs a journey's steps against the environment. Before every step a new application and runtime are built over the same
 * store, as on each Worker request (a cold restore), and the thread is loaded before the step is sent. A button step sends
 * the confirm event of the pending-action surface an earlier turn returned, exactly as the guest's card would.
 */
export async function runJourney(
  definition: RecordedJourneyDefinition,
  environment: LocalGuestEnvironment,
  model: AssistantModelClient,
): Promise<JourneyTurnOutput[]> {
  const shopPacks = definition.withSecondDomain ? [createFakeShopPack()] : undefined;
  const outputs: JourneyTurnOutput[] = [];
  const results: GuestTurnResult[] = [];
  for (const step of definition.guestTurns) {
    const fixture = wireDatedApp(environment, model, undefined, shopPacks);
    fixture.app.getState(definition.threadId);
    let result: GuestTurnResult;
    if (step.button) {
      const source = results[step.button.ofTurn];
      const card = source?.ok ? source.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId)) : undefined;
      if (!card) throw new Error(`journey ${definition.name}: turn ${step.button.ofTurn + 1} returned no pending-action surface`);
      result = await fixture.app.handleEventAsync(definition.threadId, firstButtonAction(card));
    } else {
      result = await fixture.app.handleTurn(definition.threadId, step.text);
    }
    results.push(result);
    outputs.push(outputOf(step.text, result));
  }
  return normaliseGeneratedIds(outputs);
}

const GENERATED_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Draft and pending-action ids are random UUIDs minted by the runtime, so two runs never share them. Each distinct UUID
 * becomes `generated-id-N` in order of first appearance across the journey, in surface ids and messages alike. The
 * structure the replay must reproduce (which surface, which components, in which order) is unchanged.
 */
export function normaliseGeneratedIds(outputs: readonly JourneyTurnOutput[]): JourneyTurnOutput[] {
  const seen = new Map<string, string>();
  const replace = (text: string): string => text.replace(GENERATED_ID, (id) => {
    let alias = seen.get(id);
    if (!alias) {
      alias = `generated-id-${seen.size + 1}`;
      seen.set(id, alias);
    }
    return alias;
  });
  return outputs.map((output) => ({
    ...output,
    messages: output.messages.map(replace),
    surfaces: output.surfaces.map((surface) => ({ ...surface, surfaceId: replace(surface.surfaceId) })),
  }));
}

const FALLBACK_OUTCOMES = ["rejected_plan_fallback", "scope_redirect", "scope_unavailable", "model_handling_failure", "guard_failure", "quota_refusal"];
const PENDING_SURFACE = /:pending-action:/;
const REQUEST_SURFACE = /:request:/;

/**
 * The intended outcomes a journey's recording must show (issue 03 follow-up). The recorder refuses to write a recording that
 * breaks one, and the journey test asserts the same list, so a regression cannot record its way past the check.
 * - A typed cancellation settles deterministically: the cancel copy, no pending surface, no request, no fallback outcome.
 * - A button press on a stale confirmation is refused with the expected code, and no request surface is opened.
 */
export function intendedOutcomeViolations(definition: RecordedJourneyDefinition, turns: readonly JourneyTurnOutput[]): string[] {
  const violations: string[] = [];
  definition.guestTurns.forEach((step, index) => {
    const turn = turns[index];
    if (!turn) {
      violations.push(`${definition.name}: turn ${index + 1} is missing`);
      return;
    }
    if (step.cancel) {
      if (!turn.ok || JSON.stringify(turn.messages) !== JSON.stringify([CANCEL_COPY])) violations.push(`${definition.name}: turn ${index + 1} is not the cancel copy`);
      if (turn.surfaces.some((surface) => PENDING_SURFACE.test(surface.surfaceId))) violations.push(`${definition.name}: turn ${index + 1} leaves a pending surface`);
      if (turn.surfaces.some((surface) => REQUEST_SURFACE.test(surface.surfaceId))) violations.push(`${definition.name}: turn ${index + 1} opens a request`);
      if (turn.controlOutcome !== undefined && FALLBACK_OUTCOMES.includes(turn.controlOutcome)) violations.push(`${definition.name}: turn ${index + 1} ends in fallback outcome ${turn.controlOutcome}`);
    }
    if (step.button?.expect !== undefined) {
      if (turn.ok || turn.code !== step.button.expect) violations.push(`${definition.name}: turn ${index + 1} was not refused as ${step.button.expect}`);
      if (!turn.ok && turn.messages.length > 0) violations.push(`${definition.name}: turn ${index + 1} carries messages on a refusal`);
    }
    if (step.button && turn.surfaces.some((surface) => REQUEST_SURFACE.test(surface.surfaceId))) {
      violations.push(`${definition.name}: turn ${index + 1} opens a request`);
    }
  });
  return violations;
}

/** Loads a committed recording and checks the file is a recording of this format. */
export function loadRecording(journey: string): AssistantJourneyRecording {
  const parsed: unknown = JSON.parse(readFileSync(join(RECORDINGS_DIRECTORY, `${journey}.json`), "utf8"));
  assert.ok(typeof parsed === "object" && parsed !== null, `recording ${journey} is not an object`);
  const recording = parsed as AssistantJourneyRecording;
  assert.equal(recording.format, ASSISTANT_RECORDING_FORMAT, `recording ${journey} has an unknown format`);
  assert.equal(recording.journey, journey, `recording ${journey} names another journey`);
  return recording;
}

export function definitionOf(name: string): RecordedJourneyDefinition {
  const found = RECORDED_JOURNEYS.find((journey) => journey.name === name);
  if (!found) throw new Error(`No recorded journey named ${name}`);
  return found;
}

/** Replays a recording through fresh applications, one per step, and returns the turn outputs the replay produced. */
export async function replayJourney(recording: AssistantJourneyRecording): Promise<{ turns: JourneyTurnOutput[]; replay: ReplayModelClient }> {
  const definition = definitionOf(recording.journey);
  const environment = openJourneyEnvironment();
  try {
    const replay = new ReplayModelClient(recording.exchanges);
    const turns = await runJourney(definition, environment, replay);
    replay.assertFaithful();
    return { turns, replay };
  } finally {
    environment.close();
  }
}

