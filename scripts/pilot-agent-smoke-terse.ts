import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantTurnOutput } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantControlOutcome } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { isOpenQuestion, type AssistantStayReference, type OpenQuestion } from "../apps/local-guest/src/assistant/assistant-state.js";
import type { ConciergeIntent } from "../apps/local-guest/src/assistant/scope-classifier.js";
import { providerStopReason } from "./pilot-agent-smoke-budget.js";

/**
 * Issue 61 (ADR 0106): the live terse-follow-up eval. Every offline test scripts the classifier verdict, so only a live run can catch a
 * model reading "Just me" as unclear. This runs each case once against the real model the smoke is configured for, and reports the
 * per-case verdict and the false-refusal rate as closed codes only (no model text, guest text, ids or prompts: ADR 0075).
 */

export interface TerseFollowUpCase {
  readonly id: string;
  readonly openQuestion: OpenQuestion;
  readonly text: string;
}

/**
 * The issue 61 case table. Each `id` is a neutral label (never the guest's words), so the report can name the case without carrying
 * guest text (ADR 0075); `text` is the guest message the eval sends and is never reported.
 */
export const TERSE_FOLLOW_UP_CASES: readonly TerseFollowUpCase[] = [
  { id: "party_size:solo", openQuestion: "party_size", text: "just me" },
  { id: "party_size:numeral", openQuestion: "party_size", text: "2" },
  { id: "party_size:pair", openQuestion: "party_size", text: "two of us" },
  { id: "party_size:couple", openQuestion: "party_size", text: "me and my wife" },
  { id: "nights:week", openQuestion: "nights", text: "a week" },
  { id: "nights:numeral", openQuestion: "nights", text: "3" },
  { id: "pick_result:first", openQuestion: "pick_result", text: "the first one" },
  { id: "pick_result:second", openQuestion: "pick_result", text: "the second" },
  { id: "date_confirm:affirm", openQuestion: "date_confirm", text: "yes" },
  { id: "where:area", openQuestion: "where", text: "Wuse 2" },
];

/** Closed verdict codes. `failed` means the classifier stage returned no valid verdict (it never carries model text). */
export type TerseScopeCode = "in_scope" | "mixed" | "out_of_scope" | "unclear" | "failed";
export type TerseReasonCode = "supported" | "mixed" | "outside" | "unclear" | "failed";

/**
 * Closed reason the harness could not read a verdict. `no_request` names a turn that never reached the classifier,
 * `no_response` a classifier request whose response never arrived before the stage gave up, and the rest name the response
 * defect. Every value is metadata only (ADR 0075).
 */
export type TerseScopeFailureCode =
  | "no_request"
  | "no_response"
  | "tool_calls"
  | "text_missing"
  | "not_json"
  | "scope_missing"
  | "scope_invalid"
  | "reason_missing"
  | "reason_invalid";

/** The closed path a case's turn took (issue 61 scoring). */
export type TerseCasePath = "classifier" | "classifier_failed" | "answered_without_classifier";

export interface TerseFollowUpResult {
  readonly id: string;
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
  readonly path: TerseCasePath;
  readonly pass: boolean;
  readonly falseRefusal: boolean;
}

/**
 * A small bounded request budget for the suite (a classifier plus a planner call per case, with one retry each). It is separate from
 * the journey budget so the suite can never exhaust the journeys, and it is recorded in the report.
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
  readonly cases: readonly TerseFollowUpResult[];
  /** Cases whose classifier verdict never arrived and whose turn did not answer: they block acceptance and are not false refusals. */
  readonly failedCases: number;
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
}

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
}

/** Reads a closed verdict or the closed defect from one classifier response. The response text is never kept (ADR 0075). */
function readVerdict(response: AssistantModelResponse): { readonly scope: TerseScopeCode; readonly reasonCode: TerseReasonCode } | { readonly failure: TerseScopeFailureCode } {
  if (response.toolCalls !== undefined && response.toolCalls.length > 0) return { failure: "tool_calls" };
  if (typeof response.text !== "string") return { failure: "text_missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return { failure: "not_json" };
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

/** Observes each classifier request/response; never stores model text beyond the closed codes it reads immediately. */
function observeClassifier(model: AssistantModelClient): {
  readonly client: AssistantModelClient;
  readonly takeLast: () => ObserverVerdict;
} {
  let last: ObserverVerdict = { requested: false, responded: false, scope: null, reasonCode: null, failure: null, openQuestionSent: null, resultCountSent: null };
  const client: AssistantModelClient = {
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const isScope = request.structuredOutput?.name === "concierge_scope";
      if (isScope) {
        const sent = readRequestContext(request);
        last = { ...last, requested: true, responded: false, openQuestionSent: sent.openQuestion, resultCountSent: sent.resultCount };
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
      }
      return response;
    },
    ...(model.projectProviderContinuation ? { projectProviderContinuation: model.projectProviderContinuation.bind(model) } : {}),
  };
  return { client, takeLast: () => last };
}

function emptyThreadId(index: number): string {
  return `g-af61${index.toString(16).padStart(4, "0")}`;
}

/**
 * A closed number of shown results, so a `pick_result` question is read by the classifier against a result list that exists.
 * Only the count reaches the classifier; the synthetic references never leave this harness and are never reported (ADR 0075).
 */
const SEEDED_RESULTS: readonly AssistantStayReference[] = [
  { stayRef: "stay-1", unitId: "unit-1", title: "Result 1", city: "Lagos", neighbourhood: "Old Ikoyi", capacity: 2, amenities: [], nightlyKobo: 50_000_00, allInStayTotalKobo: null, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0, amountDueNowKobo: null, inspectionStatus: "verified", managementAuthorityStatus: "verified" },
  { stayRef: "stay-2", unitId: "unit-2", title: "Result 2", city: "Lagos", neighbourhood: "Old Ikoyi", capacity: 2, amenities: [], nightlyKobo: 55_000_00, allInStayTotalKobo: null, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0, amountDueNowKobo: null, inspectionStatus: "verified", managementAuthorityStatus: "verified" },
];

/**
 * Scores one case (issue 61). A verdict-bearing case passes when it is in scope and the classifier was shown the same open question;
 * a refusal is a false refusal. A case with no verdict is scored from the turn's closed control outcome: a turn that answered the
 * guest without the classifier is a pass (the path is recorded, never a keyword shortcut), and a scope or guard failure is a failed
 * case, not a false refusal. No code here branches on guest text.
 */
export function scoreTerseCase(input: {
  readonly expected: OpenQuestion;
  readonly scope: TerseScopeCode;
  readonly openQuestionSent: OpenQuestion | null;
  readonly controlOutcome: AssistantControlOutcome | "threw" | null;
}): { readonly path: TerseCasePath; readonly pass: boolean; readonly falseRefusal: boolean } {
  if (input.scope !== "failed") {
    return {
      path: "classifier",
      pass: (input.scope === "in_scope" || input.scope === "mixed") && input.openQuestionSent === input.expected,
      falseRefusal: input.scope === "unclear" || input.scope === "out_of_scope",
    };
  }
  const answered = input.controlOutcome === "successful_model_handling" || input.controlOutcome === "support_guidance";
  return { path: answered ? "answered_without_classifier" : "classifier_failed", pass: answered, falseRefusal: false };
}

/** The closed reason no verdict was read from what the observer saw. */
function scopeFailureOf(observed: ObserverVerdict): TerseScopeFailureCode | null {
  if (observed.scope !== null) return null;
  if (observed.responded) return observed.failure ?? "not_json";
  return observed.requested ? "no_response" : "no_request";
}

/**
 * Runs every case once: the server sets the open question, then the guest sends the terse text. The verdict is the classifier's
 * closed codes; the case passes when it is in scope AND the classifier was shown the same open question, or when the turn answered
 * without the classifier (its closed path is recorded). Nothing is asserted about model text (there is none in the result).
 */
export async function evaluateTerseFollowUps(model: AssistantModelClient, options: TerseFollowUpOptions = {}): Promise<TerseFollowUpReport> {
  const requestBudget = options.requestBudget ?? TERSE_REQUEST_BUDGET;
  const results: TerseFollowUpResult[] = [];
  let skipReason = options.skipReason?.();
  if (skipReason === undefined) {
    for (const [index, testCase] of TERSE_FOLLOW_UP_CASES.entries()) {
      skipReason = options.skipReason?.();
      if (skipReason !== undefined) break;
      const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", ...(options.now ? { clock: options.now } : {}) });
      try {
        const observer = observeClassifier(model);
        const runtime = new AssistantRuntime(environment, observer.client, { packs: [createShortletAssistantPack(environment)] });
        const threadId = emptyThreadId(index);
        runtime.getThread(threadId);
        if (testCase.openQuestion === "pick_result") runtime.applyDiscoveryShortlist(threadId, SEEDED_RESULTS);
        runtime.recordOpenQuestion(threadId, testCase.openQuestion);
        let turnOutput: AssistantTurnOutput | undefined;
        let threw = false;
        try {
          // The host wraps this in an active provider turn, so the guarded model's reservation and transport accounting see it.
          await (options.runCase ?? ((_id, run) => run()))(testCase.id, async () => { turnOutput = await runtime.handleTurn(threadId, testCase.text); });
        } catch {
          threw = true;
        }
        const observed = observer.takeLast();
        if (observed.provider !== undefined) {
          // A provider rate limit or failure stops the suite; it must not keep spending its budget on a failing provider.
          const known = options.skipReason?.();
          if (known !== undefined) { skipReason = known; break; }
          const stop = providerStopReason({ providerStatusCode: observed.provider.status, providerErrorClass: observed.provider.errorClass, budgetExceeded: false });
          skipReason = stop === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "provider_failure";
          break;
        }
        const scope = observed.scope ?? "failed";
        const reasonCode = observed.reasonCode ?? "failed";
        const controlOutcome: AssistantControlOutcome | "threw" | null = threw ? "threw" : turnOutput?.controlOutcome ?? null;
        const scored = scoreTerseCase({ expected: testCase.openQuestion, scope, openQuestionSent: observed.openQuestionSent, controlOutcome });
        results.push({
          id: testCase.id,
          openQuestion: testCase.openQuestion,
          scope,
          reasonCode,
          openQuestionSent: observed.openQuestionSent,
          resultCountSent: observed.resultCountSent,
          scopeFailure: scopeFailureOf(observed),
          controlOutcome,
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
    cases: results,
    failedCases: results.filter((entry) => entry.path === "classifier_failed").length,
    falseRefusalRate: verdictCases.length === 0 ? 0 : refused / verdictCases.length,
  };
}

/** Renders the section as a markdown table of closed codes only. */
export function renderTerseFollowUpReport(report: TerseFollowUpReport): string[] {
  const verdictCases = report.cases.filter((entry) => entry.scope !== "failed");
  const refused = verdictCases.filter((entry) => entry.falseRefusal).length;
  const acceptable = report.status === "run" && report.failedCases === 0;
  const lines = [
    "## Terse follow-up cases",
    "",
    `- Status: ${report.status}${report.skipReason ? ` (${report.skipReason})` : ""}`,
    `- Request budget: ${report.requestBudget}; used: ${report.requestsUsed}`,
    `- False-refusal rate: ${report.falseRefusalRate.toFixed(3)} (${refused} of ${verdictCases.length} cases with a verdict)`,
    `- Failed cases: ${report.failedCases}`,
    `- Valid for acceptance: ${acceptable ? "yes" : `no${report.status !== "run" ? " (suite skipped)" : " (a case failed)"}`}`,
    "",
    ...(report.cases.length === 0 ? [] : [
      "| Case | Open question | Scope | Reason | Code sent | Results | Failure | Outcome | Path | Result |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...report.cases.map((entry) => `| ${entry.id} | ${entry.openQuestion} | ${entry.scope} | ${entry.reasonCode} | ${entry.openQuestionSent ?? "none"} | ${entry.resultCountSent ?? "none"} | ${entry.scopeFailure ?? "none"} | ${entry.controlOutcome ?? "none"} | ${entry.path} | ${entry.pass ? "PASS" : "FAIL"} |`),
    ]),
    "",
  ];
  return lines;
}

/** The closed intent type is re-exported only so a fake client in a test can script an in-scope verdict without its own import. */
export type { ConciergeIntent };
