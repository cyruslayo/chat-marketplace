import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp, type GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantControlOutcome } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { isOpenQuestion, type AssistantTaskState, type OpenQuestion } from "../apps/local-guest/src/assistant/assistant-state.js";
import { invalidJsonReason, type ConciergeIntent, type ScopeFailureReason } from "../apps/local-guest/src/assistant/scope-classifier.js";
import { SCOPE_FIRST_ATTEMPT_TIMEOUT_MS, SCOPE_RETRY_TIMEOUT_MS, SCOPE_TOTAL_BUDGET_MS } from "../apps/local-guest/src/assistant/scope-classifier-retry.js";
import { providerStopReason } from "./pilot-agent-smoke-budget.js";

/**
 * Issue 61 (ADR 0106): the live terse-follow-up eval. Every offline test scripts the classifier verdict, so only a live run can catch a
 * model reading "Just me" as unclear. This runs each case once against the real model the smoke is configured for, and reports the
 * per-case verdict and the false-refusal rate as closed codes only (no model text, guest text, ids or prompts: ADR 0075).
 *
 * Issue 63: a verdict is not an answer. Each case now runs the real cold journey that reaches the question (a real search, a real
 * discovery surface, a server-shown date), sends the terse reply to the live model, then cold-restores and reads the task state. A case
 * passes only when the verdict is in scope, the classifier was shown the right open question, AND the thread kept the answered slot.
 * The set-up messages are answered by a closed scripted model: only the measured reply reaches the live model.
 */

/**
 * The staging-like clock (27 Oct 2026, Africa/Lagos) every case's journey runs on, so "tomorrow" is a fixed show-back date and a
 * December stay is inside the 90-day Booking Horizon (ADR 0055). A fixture value, not a policy: the guest messages below state it.
 */
export const TERSE_CLOCK = (): Date => new Date("2026-10-27T10:00:00Z");

/** The closed area and dates the set-up journeys use. Guest messages carry the same facts; the clock is fixed (TERSE_CLOCK). */
const LAGOS_AREA = { city: "Lagos", neighbourhood: "Lekki Phase 1" } as const;
const LAGOS_CITY = { city: "Lagos" } as const;
/** A search with no party size: the assistant asks `party_size`. */
const PARTY_MISSING = "Apartment in Lekki for 3 nights from 14 December 2026";
/** A search with no nights: the assistant asks `nights`. */
const NIGHTS_MISSING = "Apartment in Lekki for 2 guests from 14 December 2026";
/** A relative date the server resolves and shows back: the assistant asks `date_confirm`. */
const DATE_SHOW_BACK = "Apartment in Lekki for 2 guests for 3 nights tomorrow";
/** A city-wide search with more than one result, so a vague view asks `pick_result`. */
const PICK_SEARCH = "Apartment in Lagos for 2 guests for 3 nights from 14 December 2026";
const VAGUE_VIEW = "Show me the apartment";
/** A stay request with no area: the assistant asks `where`. */
const AREA_QUESTION = "I need a place for 2 guests for 3 nights from 14 December 2026";

export interface TerseFollowUpCase {
  readonly id: string;
  readonly openQuestion: OpenQuestion;
  readonly text: string;
  /**
   * The guest messages, on a fresh thread, that reach the question a real guest would be asked: a real search that ends with the
   * assistant asking for the missing fact, and for a pick the vague "show me" turn that makes it ask which result.
   */
  readonly setup: readonly string[];
  /** For a `pick_result` case: the set-up search must show more than one result, or the assistant cannot ask which one. */
  readonly needsResults?: boolean;
}

/**
 * The issue 61 case table. Each `id` is a neutral label (never the guest's words), so the report can name the case without carrying
 * guest text (ADR 0075); `text` is the guest message the eval sends and is never reported.
 *
 * The first ten cases are the original table. The four `held-out` cases are deliberately absent from the classifier instruction and
 * every other prompt: they check that a pass is the model's reading, not wording it was shown. The instruction only states general
 * rules (a party size in words or as a relationship, a stay length in days/weeks/months, a named position among the shown results,
 * an acceptance or refusal of a value shown back). The held-out confirmation is a wording the closed confirmation set already accepts,
 * so its answer can settle the shown-back date as the original case's does.
 */
export const TERSE_FOLLOW_UP_CASES: readonly TerseFollowUpCase[] = [
  { id: "party_size:solo", openQuestion: "party_size", text: "just me", setup: [PARTY_MISSING] },
  { id: "party_size:numeral", openQuestion: "party_size", text: "2", setup: [PARTY_MISSING] },
  { id: "party_size:pair", openQuestion: "party_size", text: "two of us", setup: [PARTY_MISSING] },
  { id: "party_size:couple", openQuestion: "party_size", text: "me and my wife", setup: [PARTY_MISSING] },
  { id: "party_size:held-out-partner", openQuestion: "party_size", text: "my partner and I", setup: [PARTY_MISSING] },
  { id: "nights:week", openQuestion: "nights", text: "a week", setup: [NIGHTS_MISSING] },
  { id: "nights:numeral", openQuestion: "nights", text: "3", setup: [NIGHTS_MISSING] },
  { id: "nights:held-out-fortnight", openQuestion: "nights", text: "two weeks", setup: [NIGHTS_MISSING] },
  { id: "pick_result:first", openQuestion: "pick_result", text: "the first one", setup: [PICK_SEARCH, VAGUE_VIEW], needsResults: true },
  { id: "pick_result:second", openQuestion: "pick_result", text: "the second", setup: [PICK_SEARCH, VAGUE_VIEW], needsResults: true },
  { id: "pick_result:held-out-last", openQuestion: "pick_result", text: "the last one", setup: [PICK_SEARCH, VAGUE_VIEW], needsResults: true },
  { id: "date_confirm:affirm", openQuestion: "date_confirm", text: "yes", setup: [DATE_SHOW_BACK] },
  { id: "date_confirm:held-out-accept", openQuestion: "date_confirm", text: "go ahead", setup: [DATE_SHOW_BACK] },
  { id: "where:area", openQuestion: "where", text: "Wuse 2", setup: [AREA_QUESTION] },
];

/** Closed verdict codes. `failed` means the classifier stage returned no valid verdict (it never carries model text). */
export type TerseScopeCode = "in_scope" | "mixed" | "out_of_scope" | "unclear" | "failed";
export type TerseReasonCode = "supported" | "mixed" | "outside" | "unclear" | "failed";

/** The classifier's own closed JSON-parse defect codes, so a no-verdict row names whether the provider truncated, fenced, wrapped or wrote prose (ADR 0106, 26 Oct 2026). */
export type TerseJsonParseFailureCode = Extract<ScopeFailureReason, `invalid_json_${string}`>;

/**
 * The closed reason no verdict was read. `setup_failed` names a journey that never reached the question (so the case
 * was not measured), `no_request` names a turn that never reached the classifier, `no_response` a classifier request whose response
 * never arrived before the stage gave up, and the rest name the response defect. Every value is metadata only (ADR 0075); the
 * parse defects reuse the runtime classifier's own codes, never a new vocabulary.
 */
export type TerseScopeFailureCode =
  | "setup_failed"
  | "no_request"
  | "no_response"
  | "tool_calls"
  | "text_missing"
  | TerseJsonParseFailureCode
  | "scope_missing"
  | "scope_invalid"
  | "reason_missing"
  | "reason_invalid";

/** The closed path a case's turn took (issue 61 scoring). */
export type TerseCasePath = "classifier" | "classifier_failed" | "answered_without_classifier";

export interface TerseFollowUpResult {
  readonly id: string;
  /** Which run of the case this is (1-based); a case runs once per configured run. */
  readonly run: number;
  readonly openQuestion: OpenQuestion;
  readonly scope: TerseScopeCode;
  readonly reasonCode: TerseReasonCode;
  readonly openQuestionSent: OpenQuestion | null;
  /** The closed number of results the classifier request carried, or null when it carried none. */
  readonly resultCountSent: number | null;
  /** The closed reason no verdict was read, or null when one was read. */
  readonly scopeFailure: TerseScopeFailureCode | null;
  /** The turn's closed control outcome, `threw`, or null when the turn never ran. */
  readonly controlOutcome: AssistantControlOutcome | "threw" | null;
  /** True when the thread held the answered slot after a cold restore, read from task state with closed values. */
  readonly answeredSlotHeld: boolean;
  /**
   * Issue 63: what the planner did on the measured turn, in order, as closed codes only: `tool(slotKeys)` for a tool call (the
   * schema argument names it filled, sorted, never their values), `denied:tool[:CODE]` for a tool result the runtime refused,
   * `reply:kind` for a typed reply plan (a kind from the reply schema), `text` for an untyped reply. Never guest or model text.
   */
  readonly plannerActions: readonly string[];
  readonly path: TerseCasePath;
  readonly pass: boolean;
  readonly falseRefusal: boolean;
}

/**
 * A small bounded request budget for the suite (a classifier plus a planner call per case, with one retry each). It is separate from
 * the journey budget so the suite can never exhaust the journeys, and it is recorded in the report. The set-up turns of a case are
 * answered by the scripted model and spend none of it.
 */
export const TERSE_REQUESTS_PER_CASE = 4;
export const TERSE_REQUEST_BUDGET = TERSE_FOLLOW_UP_CASES.length * TERSE_REQUESTS_PER_CASE;

export type TerseSkipReason = "rate_limited" | "provider_failure" | "request_budget_exceeded" | "terse_budget_exceeded";

export interface TerseFollowUpReport {
  readonly status: "run" | "skipped";
  readonly skipReason?: TerseSkipReason;
  /** The suite's own request budget and how much of it was used. */
  readonly requestBudget: number;
  readonly requestsUsed: number;
  /** How many times each case ran (issue 63: one live sample cannot tell a flaky model from a broken path). */
  readonly runs: number;
  readonly cases: readonly TerseFollowUpResult[];
  /** Cases whose classifier verdict never arrived and whose turn did not answer: they block acceptance and are not false refusals. */
  readonly failedCases: number;
  /** Cases whose classifier response never arrived before the stage gave up. A latency failure, counted apart from refusals. */
  readonly timeouts: number;
  /** In-scope cases refused as unclear or out_of_scope, divided by the cases that returned a verdict. */
  readonly falseRefusalRate: number;
}

export interface TerseFollowUpOptions {
  readonly now?: () => Date;
  readonly requestBudget?: number;
  readonly requestsUsed?: () => number;
  /** Returns a closed skip reason when the suite must not run (a rate-limit or journey-budget stop, or its own budget exhausted). */
  readonly skipReason?: () => TerseSkipReason | undefined;
  /** Wraps one case's turn in the host's active provider turn, so provider reservation and transport accounting see it. */
  readonly runCase?: (caseId: string, run: () => Promise<void>) => Promise<void>;
  /** How many times to run each case, 1 to MAX_TERSE_RUNS (the smoke's `--runs`). Every run of every case must pass for acceptance. */
  readonly runs?: number;
}

/** The most runs per case the suite accepts; it matches the smoke's journey run limit (MAX_PILOT_AGENT_SMOKE_RUNS). */
export const MAX_TERSE_RUNS = 3;

const SCOPES: readonly TerseScopeCode[] = ["in_scope", "mixed", "out_of_scope", "unclear"];
const REASONS: readonly TerseReasonCode[] = ["supported", "mixed", "outside", "unclear"];

interface ObserverVerdict {
  /** True once a `concierge_scope` request was seen: the request side proves the context that was sent. */
  requested: boolean;
  /** True when the last seen `concierge_scope` request received a response before the case read its verdict. */
  responded: boolean;
  scope: TerseScopeCode | null;
  reasonCode: TerseReasonCode | null;
  failure: TerseScopeFailureCode | null;
  openQuestionSent: OpenQuestion | null;
  resultCountSent: number | null;
  /** Set when a provider call threw; the suite stops rather than spend more of its budget on a failing provider. */
  provider?: { readonly status?: number; readonly errorClass?: string };
  /** Issue 63: the planner's closed actions on the measured turn, in order (see TerseFollowUpResult.plannerActions). */
  plannerActions: string[];
}

/** A closed code shape: the reply kinds, tool names and denial codes the report may carry are all of this form. */
const CLOSED_TOKEN = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;

/** `tool(keys)`: the tool name the request offered and the schema argument names the call filled (non-null), sorted. No values. */
function plannerToolAction(request: AssistantModelRequest, call: { readonly name: string; readonly args: Record<string, unknown> }): string {
  const tool = request.tools.find((definition) => definition.name === call.name);
  if (tool === undefined) return "unknown_tool";
  const schemaKeys = new Set(Object.keys(tool.parametersSchema.properties));
  const filled = Object.entries(call.args)
    .filter(([key, value]) => schemaKeys.has(key) && value !== null && value !== undefined)
    .map(([key]) => key)
    .sort();
  return `${tool.name}(${filled.join(",")})`;
}

/** `reply:kind` when the typed reply names a kind the reply schema allows; `reply:unreadable` otherwise; `text` for an untyped reply. */
function plannerReplyAction(request: AssistantModelRequest, response: AssistantModelResponse): string {
  if (request.structuredOutput === undefined) return "text";
  const kindSchema = (request.structuredOutput.schema as { readonly properties?: { readonly kind?: { readonly enum?: readonly unknown[] } } }).properties?.kind;
  try {
    const parsed = JSON.parse(response.text ?? "") as { readonly kind?: unknown };
    const allowed = kindSchema?.enum;
    if (typeof parsed.kind === "string" && CLOSED_TOKEN.test(parsed.kind) && (allowed === undefined || allowed.includes(parsed.kind))) return `reply:${parsed.kind}`;
  } catch { /* The text is discarded either way. */ }
  return "reply:unreadable";
}

/** `denied:tool[:CODE]` for each refused tool result the request carries back to the planner; the code only when it is a closed token. */
function plannerDenials(request: AssistantModelRequest): string[] {
  const last = request.history.at(-1);
  if (last?.role !== "tool_results") return [];
  return last.results.filter((result) => result.isError === true).map((result) => {
    const code = (result.result as { readonly code?: unknown }).code;
    const name = CLOSED_TOKEN.test(result.name) ? result.name : "unknown_tool";
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,47}$/.test(code) ? `denied:${name}:${code}` : `denied:${name}`;
  });
}

/** Reads a closed verdict or the closed defect from one classifier response. The response text is never kept (ADR 0075). */
function readVerdict(response: AssistantModelResponse): { readonly scope: TerseScopeCode; readonly reasonCode: TerseReasonCode } | { readonly failure: TerseScopeFailureCode } {
  if (response.toolCalls !== undefined && response.toolCalls.length > 0) return { failure: "tool_calls" };
  if (typeof response.text !== "string") return { failure: "text_missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    // The runtime classifier's own closed code names the parse defect (truncation vs prose vs fenced), never the text.
    return { failure: invalidJsonReason(response.text, response.finishReason) };
  }
  const value = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (!("scope" in value)) return { failure: "scope_missing" };
  if (typeof value.scope !== "string" || !(SCOPES as readonly string[]).includes(value.scope)) return { failure: "scope_invalid" };
  if (!("reasonCode" in value)) return { failure: "reason_missing" };
  if (typeof value.reasonCode !== "string" || !(REASONS as readonly string[]).includes(value.reasonCode)) return { failure: "reason_invalid" };
  return { scope: value.scope as TerseScopeCode, reasonCode: value.reasonCode as TerseReasonCode };
}

/** Reads the closed request-side facts (open question and result count) from the classifier envelope. */
function readRequestContext(request: AssistantModelRequest): { readonly openQuestion: OpenQuestion | null; readonly resultCount: number | null } {
  const user = [...request.history].reverse().find((step) => step.role === "user");
  if (!user || !("text" in user)) return { openQuestion: null, resultCount: null };
  try {
    const envelope = JSON.parse(user.text) as { readonly context?: { readonly openQuestion?: unknown; readonly resultCount?: unknown } };
    const context = envelope.context;
    const openQuestion = isOpenQuestion(context?.openQuestion) ? context.openQuestion : null;
    const resultCount = typeof context?.resultCount === "number" && Number.isSafeInteger(context.resultCount) ? context.resultCount : null;
    return { openQuestion, resultCount };
  } catch {
    return { openQuestion: null, resultCount: null };
  }
}

/** The guest message a request carries: the classifier envelope's `message`, or the last user step's text. Never reported. */
function requestMessage(request: AssistantModelRequest): string | undefined {
  const user = [...request.history].reverse().find((step) => step.role === "user");
  if (!user || !("text" in user)) return undefined;
  try {
    const envelope = JSON.parse(user.text) as { readonly message?: unknown };
    return typeof envelope.message === "string" ? envelope.message : user.text;
  } catch {
    return user.text;
  }
}

/** Observes each classifier request/response; never stores model text beyond the closed codes it reads immediately. */
function observeClassifier(model: AssistantModelClient): {
  readonly client: AssistantModelClient;
  readonly takeLast: () => ObserverVerdict;
} {
  let last: ObserverVerdict = { requested: false, responded: false, scope: null, reasonCode: null, failure: null, openQuestionSent: null, resultCountSent: null, plannerActions: [] };
  const client: AssistantModelClient = {
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const isScope = request.structuredOutput?.name === "concierge_scope";
      if (isScope) {
        const sent = readRequestContext(request);
        last = { ...last, requested: true, responded: false, openQuestionSent: sent.openQuestion, resultCountSent: sent.resultCount };
      } else {
        // Issue 63: a tool result the runtime refused comes back to the planner on its next request; record it by closed code only.
        last.plannerActions.push(...plannerDenials(request));
      }
      let response: AssistantModelResponse;
      try {
        response = await model.generate(request);
      } catch (error) {
        // A thrown provider error (rate limit, transport, guard) is recorded by its closed status/class only, then rethrown.
        const status = typeof (error as { readonly status?: unknown })?.status === "number" ? (error as { readonly status: number }).status : undefined;
        const errorClass = error instanceof Error ? error.constructor.name : undefined;
        last = { ...last, provider: { ...(status === undefined ? {} : { status }), ...(errorClass === undefined ? {} : { errorClass }) } };
        throw error;
      }
      if (isScope) {
        const verdict = readVerdict(response);
        last = "failure" in verdict
          ? { ...last, responded: true, scope: null, reasonCode: null, failure: verdict.failure }
          : { ...last, responded: true, scope: verdict.scope, reasonCode: verdict.reasonCode, failure: null };
      } else if (response.toolCalls !== undefined && response.toolCalls.length > 0) {
        last.plannerActions.push(...response.toolCalls.map((call) => plannerToolAction(request, call)));
      } else {
        last.plannerActions.push(plannerReplyAction(request, response));
      }
      return response;
    },
    ...(model.projectProviderContinuation ? { projectProviderContinuation: model.projectProviderContinuation.bind(model) } : {}),
  };
  return { client, takeLast: () => last };
}

function terseThreadId(index: number): string {
  return `g-af63${index.toString(16).padStart(4, "0")}`;
}

/** One scripted set-up turn. It is the guest's earlier journey, so its wording and slots are closed here, never model output. */
interface SetupTurn {
  readonly slots: Readonly<Record<string, string | number | null>>;
  readonly intents: readonly ConciergeIntent[];
  readonly search?: Readonly<Record<string, unknown>>;
  /** A typed reply plan with no tool call (the staying clarification that asks for the missing fact). */
  readonly reply?: { readonly kind: string; readonly references: readonly string[] };
  /** The planner provider fails, so the shell's deterministic path answers (the "which one" question). */
  readonly providerDown?: true;
}

const SETUP_TURNS: Readonly<Record<string, SetupTurn>> = {
  [PARTY_MISSING]: { slots: { ...LAGOS_AREA, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS_AREA, checkIn: "2026-12-14", nights: 3 } },
  [NIGHTS_MISSING]: { slots: { ...LAGOS_AREA, checkIn: "2026-12-14", guests: 2 }, intents: ["search"], search: { ...LAGOS_AREA, checkIn: "2026-12-14", guests: 2 } },
  [DATE_SHOW_BACK]: { slots: { ...LAGOS_AREA, nights: 3, guests: 2 }, intents: ["search"], search: { ...LAGOS_AREA, checkInPhrase: "tomorrow", nights: 3, guests: 2 } },
  [PICK_SEARCH]: { slots: { ...LAGOS_CITY, checkIn: "2026-12-14", nights: 3, guests: 2 }, intents: ["search"], search: { ...LAGOS_CITY, checkIn: "2026-12-14", nights: 3, guests: 2 } },
  [VAGUE_VIEW]: { slots: {}, intents: ["details"], providerDown: true },
  [AREA_QUESTION]: { slots: { guests: 2, nights: 3, checkIn: "2026-12-14" }, intents: ["search"], reply: { kind: "clarify_stay", references: [] } },
};

const EMPTY_SETUP_SLOTS = { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } as const;

/** The closed scripted model for a case's set-up journey. It never reaches the live provider, so it spends no request budget. */
function setupModel(): AssistantModelClient {
  return {
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const message = requestMessage(request) ?? "";
      const turn = SETUP_TURNS[message];
      if (request.structuredOutput?.name === "concierge_scope") {
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: turn?.intents ?? ["search"], reasonCode: "supported", slots: { ...EMPTY_SETUP_SLOTS, ...(turn?.slots ?? {}) } }) };
      }
      const last = request.history.at(-1);
      if (last?.role === "tool_results") return { text: JSON.stringify({ kind: "show_results", references: [] }) };
      if (turn?.providerDown) throw Object.assign(new Error("set-up provider unavailable"), { status: 503 });
      if (turn?.reply !== undefined) return { text: JSON.stringify(turn.reply) };
      if (turn?.search !== undefined) return { toolCalls: [{ id: "setup-search", name: "search_stays", args: turn.search }] };
      throw new Error("The set-up journey has no scripted turn");
    },
  };
}

/** Routes the set-up messages to the scripted model and everything else (the measured reply) to the live model. */
function routeModel(live: AssistantModelClient, setup: AssistantModelClient): AssistantModelClient {
  return {
    generate: (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const message = requestMessage(request);
      return message !== undefined && SETUP_TURNS[message] !== undefined ? setup.generate(request) : live.generate(request);
    },
    ...(live.projectProviderContinuation ? { projectProviderContinuation: live.projectProviderContinuation.bind(live) } : {}),
  };
}

/** One application over the store, loaded as a page load does: the cold restore every Worker request performs (ADR 0106). */
function openCaseApp(environment: LocalGuestEnvironment, model: AssistantModelClient, threadId: string): { readonly app: LocalGuestApp; readonly runtime: AssistantRuntime } {
  const runtime = new AssistantRuntime(environment, model, { packs: [createShortletAssistantPack(environment)] });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime });
  app.getState(threadId);
  return { app, runtime };
}

/**
 * True when the thread holds the slot the open question asked for, read from task state with closed values only (issue 61: a
 * no-verdict case passes only when the guest's answer landed). `expectedResultCount` is the number of results the case showed, so
 * a selected result must be one of them. It never reads guest or model text.
 */
export function holdsAnsweredSlot(state: AssistantTaskState, openQuestion: OpenQuestion, expectedResultCount: number): boolean {
  const stay = state.stayIntent;
  switch (openQuestion) {
    case "party_size":
      return Number.isSafeInteger(stay.partySize) && (stay.partySize ?? 0) > 0;
    case "nights":
    case "stay_length":
      return (Number.isSafeInteger(stay.nights) && (stay.nights ?? 0) > 0) || stay.statedStay !== undefined;
    case "pick_result": {
      if (typeof state.selectedStayRef !== "string") return false;
      const match = /^stay-(\d+)$/.exec(state.selectedStayRef);
      const index = match ? Number(match[1]) : Number.NaN;
      return Number.isSafeInteger(index) && index >= 1 && index <= expectedResultCount;
    }
    case "check_in":
    case "date_confirm":
      // ADR 0092: only a guest-authored (or confirmed show-back) check-in answers these; a demo date authorizes nothing.
      return typeof stay.checkIn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stay.checkIn) && stay.isDemoDate === false;
    case "where":
    case "location_confirm":
      return stay.location === "Lagos" || stay.location === "Abuja";
  }
}

/**
 * Scores one case (issues 61 and 63). A verdict-bearing case passes when it is in scope, the classifier was shown the same open
 * question, AND the thread kept the answered slot after a cold restore: a verdict with no answer is a FAIL. A refusal is a false
 * refusal. A case with no verdict passes only when the turn's closed outcome is a model answer AND the thread then holds the
 * answered slot; `support_guidance`, a missing slot, a scope failure or a guard failure is a failed case, never a false refusal.
 * No code here branches on guest text.
 */
export function scoreTerseCase(input: {
  readonly expected: OpenQuestion;
  readonly scope: TerseScopeCode;
  readonly openQuestionSent: OpenQuestion | null;
  readonly controlOutcome: AssistantControlOutcome | "threw" | null;
  readonly answeredSlotHeld: boolean;
}): { readonly path: TerseCasePath; readonly pass: boolean; readonly falseRefusal: boolean } {
  if (input.scope !== "failed") {
    const verdict = (input.scope === "in_scope" || input.scope === "mixed") && input.openQuestionSent === input.expected;
    return {
      path: "classifier",
      // Issue 63: the answer must land, not only the verdict.
      pass: verdict && input.answeredSlotHeld,
      falseRefusal: input.scope === "unclear" || input.scope === "out_of_scope",
    };
  }
  const answered = input.controlOutcome === "successful_model_handling" && input.answeredSlotHeld;
  return { path: answered ? "answered_without_classifier" : "classifier_failed", pass: answered, falseRefusal: false };
}

/** The closed reason no verdict was read from what the observer saw. */
function scopeFailureOf(observed: ObserverVerdict): TerseScopeFailureCode | null {
  if (observed.scope !== null) return null;
  // A response that produced no verdict always carries its closed defect from readVerdict; the fallback is unreachable by construction.
  if (observed.responded) return observed.failure ?? "text_missing";
  return observed.requested ? "no_response" : "no_request";
}

/** The closed result count a restored task state shows (a count only; never a listing, title or unit). */
function shownResults(state: AssistantTaskState): number {
  return state.shortlist.length;
}

/**
 * Runs every case once as the journey a real guest takes. The set-up messages reach the question (a search that asks for the missing
 * fact, a discovery surface that makes the assistant ask which result, a date the server shows back). The measured reply goes to the
 * live model; then a cold restore reads the task state. A case passes when the reply was in scope, shown the right open question,
 * and its answer is in the thread. Nothing is asserted about model text (there is none in the result).
 */
export async function evaluateTerseFollowUps(model: AssistantModelClient, options: TerseFollowUpOptions = {}): Promise<TerseFollowUpReport> {
  const runs = options.runs ?? 1;
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > MAX_TERSE_RUNS) throw new Error(`Terse follow-up runs must be between 1 and ${MAX_TERSE_RUNS}.`);
  const requestBudget = options.requestBudget ?? TERSE_REQUEST_BUDGET * runs;
  const clock = options.now ?? TERSE_CLOCK;
  const results: TerseFollowUpResult[] = [];
  let skipReason = options.skipReason?.();
  if (skipReason === undefined) {
    runLoop: for (let run = 1; run <= runs; run++) for (const [index, testCase] of TERSE_FOLLOW_UP_CASES.entries()) {
      skipReason = options.skipReason?.();
      if (skipReason !== undefined) break runLoop;
      const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock });
      try {
        const observer = observeClassifier(model);
        const routed = routeModel(observer.client, setupModel());
        const threadId = terseThreadId(index);
        let setupFailure = false;
        let setupResults = 0;
        for (const text of testCase.setup) {
          const { app, runtime } = openCaseApp(environment, routed, threadId);
          const turn: GuestTurnResult = await app.handleTurn(threadId, text);
          if (!turn.ok) { setupFailure = true; break; }
          setupResults = shownResults(runtime.getThread(threadId).taskState);
        }
        if (setupFailure || (testCase.needsResults === true && setupResults < 2)) {
          // The journey never reached the question, so the case was not measured. A closed code only; it blocks acceptance.
          results.push({
            id: testCase.id, run, openQuestion: testCase.openQuestion, scope: "failed", reasonCode: "failed", openQuestionSent: null,
            resultCountSent: null, scopeFailure: "setup_failed", controlOutcome: null, answeredSlotHeld: false, plannerActions: [],
            path: "classifier_failed", pass: false, falseRefusal: false,
          });
          continue;
        }
        let controlOutcome: AssistantControlOutcome | "threw" | null = null;
        let threw = false;
        try {
          // The host wraps this in an active provider turn, so the guarded model's reservation and transport accounting see it.
          await (options.runCase ?? ((_id, run) => run()))(testCase.id, async () => {
            const { app } = openCaseApp(environment, routed, threadId);
            const turn = await app.handleTurn(threadId, testCase.text);
            controlOutcome = turn.ok && turn.assistantControlOutcome !== undefined ? turn.assistantControlOutcome : null;
          });
        } catch {
          threw = true;
        }
        const observed = observer.takeLast();
        if (observed.provider !== undefined) {
          // A provider rate limit or failure stops the suite; it must not keep spending its budget on a failing provider.
          const known = options.skipReason?.();
          if (known !== undefined) { skipReason = known; break runLoop; }
          const stop = providerStopReason({ providerStatusCode: observed.provider.status, providerErrorClass: observed.provider.errorClass, budgetExceeded: false });
          skipReason = stop === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "provider_failure";
          break runLoop;
        }
        // The cold restore after the turn: a NEW application over the same store, as the next Worker request would build.
        const restored = openCaseApp(environment, routed, threadId).runtime.getThread(threadId).taskState;
        const scope = observed.scope ?? "failed";
        const reasonCode = observed.reasonCode ?? "failed";
        const outcome: AssistantControlOutcome | "threw" | null = threw ? "threw" : controlOutcome;
        // Issue 63: the closed slot check reads the restored thread, so a fact kept only in memory is a FAIL.
        const answeredSlotHeld = holdsAnsweredSlot(restored, testCase.openQuestion, shownResults(restored));
        const scored = scoreTerseCase({ expected: testCase.openQuestion, scope, openQuestionSent: observed.openQuestionSent, controlOutcome: outcome, answeredSlotHeld });
        results.push({
          id: testCase.id,
          run,
          openQuestion: testCase.openQuestion,
          scope,
          reasonCode,
          openQuestionSent: observed.openQuestionSent,
          resultCountSent: observed.resultCountSent,
          scopeFailure: scopeFailureOf(observed),
          controlOutcome: outcome,
          answeredSlotHeld,
          plannerActions: [...observed.plannerActions],
          ...scored,
        });
      } finally {
        environment.close();
      }
    }
  }
  // The false-refusal rate is over the cases that returned a verdict; a case with no verdict is excluded and counted separately.
  const verdictCases = results.filter((entry) => entry.scope !== "failed");
  const refused = verdictCases.filter((entry) => entry.falseRefusal).length;
  return {
    status: skipReason === undefined ? "run" : "skipped",
    ...(skipReason === undefined ? {} : { skipReason }),
    requestBudget,
    requestsUsed: options.requestsUsed?.() ?? 0,
    runs,
    cases: results,
    failedCases: results.filter((entry) => entry.path === "classifier_failed").length,
    timeouts: results.filter((entry) => entry.scopeFailure === "no_response").length,
    falseRefusalRate: verdictCases.length === 0 ? 0 : refused / verdictCases.length,
  };
}

/** The classifier stage's configured caps, shown so a latency failure is read against the budget it exceeded. */
const CLASSIFIER_TIMEOUT_TEXT = `${SCOPE_FIRST_ATTEMPT_TIMEOUT_MS / 1000} s first attempt, ${SCOPE_RETRY_TIMEOUT_MS / 1000} s retry, ${SCOPE_TOTAL_BUDGET_MS / 1000} s stage`;

/** Renders the section as a markdown table of closed codes only. */
export function renderTerseFollowUpReport(report: TerseFollowUpReport): string[] {
  const verdictCases = report.cases.filter((entry) => entry.scope !== "failed");
  const refused = verdictCases.filter((entry) => entry.falseRefusal).length;
  // Issue 63: acceptance needs every run of every case to pass the rule, not only a verdict from each (the 12 Nov run read "yes"
  // with three cases failing). A skipped suite, or one that ran fewer cases than the table, is never valid.
  const failingPassRule = report.cases.filter((entry) => !entry.pass).length;
  const complete = report.cases.length === TERSE_FOLLOW_UP_CASES.length * report.runs;
  const acceptable = report.status === "run" && complete && failingPassRule === 0;
  const invalidReason = report.status !== "run" ? "suite skipped" : !complete ? "not every case ran" : `${failingPassRule} cases failed the pass rule`;
  const lines = [
    "## Terse follow-up cases",
    "",
    `- Status: ${report.status}${report.skipReason ? ` (${report.skipReason})` : ""}`,
    `- Runs per case: ${report.runs}`,
    `- Request budget: ${report.requestBudget}; used: ${report.requestsUsed}`,
    `- False-refusal rate: ${report.falseRefusalRate.toFixed(3)} (${refused} of ${verdictCases.length} cases with a verdict)`,
    `- Failed cases: ${report.failedCases}`,
    `- Classifier timeouts: ${report.timeouts} (no_response; ${CLASSIFIER_TIMEOUT_TEXT})`,
    `- Valid for acceptance: ${acceptable ? "yes" : `no (${invalidReason})`}`,
    "",
    ...(report.cases.length === 0 ? [] : [
      "| Case | Run | Open question | Scope | Reason | Code sent | Results | Failure | Outcome | Planner | Slot | Path | Result |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...report.cases.map((entry) => `| ${entry.id} | ${entry.run} | ${entry.openQuestion} | ${entry.scope} | ${entry.reasonCode} | ${entry.openQuestionSent ?? "none"} | ${entry.resultCountSent ?? "none"} | ${entry.scopeFailure ?? "none"} | ${entry.controlOutcome ?? "none"} | ${entry.plannerActions.length === 0 ? "none" : entry.plannerActions.join(" > ")} | ${entry.answeredSlotHeld ? "held" : "no"} | ${entry.path} | ${entry.pass ? "PASS" : "FAIL"} |`),
    ]),
    "",
  ];
  return lines;
}

/** The closed intent type is re-exported only so a fake client in a test can script an in-scope verdict without its own import. */
export type { ConciergeIntent };
