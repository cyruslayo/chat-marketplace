import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { ConciergeIntent } from "../apps/local-guest/src/assistant/scope-classifier.js";
import { isOpenQuestion, type OpenQuestion } from "../apps/local-guest/src/assistant/assistant-state.js";
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

export interface TerseFollowUpResult {
  readonly id: string;
  readonly openQuestion: OpenQuestion;
  readonly scope: TerseScopeCode;
  readonly reasonCode: TerseReasonCode;
  readonly openQuestionSent: OpenQuestion | null;
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
  /** Cases whose classifier verdict never arrived; they are excluded from the false-refusal denominator and block acceptance. */
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
  scope: TerseScopeCode;
  reasonCode: TerseReasonCode;
  openQuestionSent: OpenQuestion | null;
  /** Set when a provider call threw; the suite stops rather than spend more of its budget on a failing provider. */
  provider?: { readonly status?: number; readonly errorClass?: string };
}

/** Observes each classifier request/response; never stores model text beyond the closed codes it reads immediately. */
function observeClassifier(model: AssistantModelClient): {
  readonly client: AssistantModelClient;
  readonly takeLast: () => ObserverVerdict;
} {
  let last: ObserverVerdict = { scope: "failed", reasonCode: "failed", openQuestionSent: null };
  const client: AssistantModelClient = {
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
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
      if (request.structuredOutput?.name === "concierge_scope") {
        let scope: TerseScopeCode = "failed";
        let reasonCode: TerseReasonCode = "failed";
        try {
          const parsed = JSON.parse(response.text ?? "") as { readonly scope?: unknown; readonly reasonCode?: unknown };
          if (typeof parsed.scope === "string" && (SCOPES as readonly string[]).includes(parsed.scope)) scope = parsed.scope as TerseScopeCode;
          if (typeof parsed.reasonCode === "string" && (REASONS as readonly string[]).includes(parsed.reasonCode)) reasonCode = parsed.reasonCode as TerseReasonCode;
        } catch { /* A parsed failure stays `failed`; the text is discarded. */ }
        const user = [...request.history].reverse().find((step) => step.role === "user");
        let openQuestionSent: OpenQuestion | null = null;
        if (user && "text" in user) {
          try {
            const envelope = JSON.parse(user.text) as { readonly context?: { readonly openQuestion?: unknown } };
            if (isOpenQuestion(envelope.context?.openQuestion)) openQuestionSent = envelope.context.openQuestion;
          } catch { /* No context means no code sent. */ }
        }
        last = { scope, reasonCode, openQuestionSent };
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
 * Runs every case once: the server sets the open question, then the guest sends the terse text. The verdict is the classifier's
 * closed codes; the case passes when it is in scope AND the classifier was shown the same open question. Nothing is asserted about
 * model text (there is none in the result).
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
        runtime.recordOpenQuestion(threadId, testCase.openQuestion);
        try {
          // The host wraps this in an active provider turn, so the guarded model's reservation and transport accounting see it.
          await (options.runCase ?? ((_id, run) => run()))(testCase.id, async () => { await runtime.handleTurn(threadId, testCase.text); });
        } catch {
          // A hard failure leaves no verdict (recorded as `failed`); a provider stop is detected from the observer below.
        }
        const verdict = observer.takeLast();
        if (verdict.provider !== undefined) {
          // A provider rate limit or failure stops the suite; it must not keep spending its budget on a failing provider.
          const known = options.skipReason?.();
          if (known !== undefined) { skipReason = known; break; }
          const stop = providerStopReason({ providerStatusCode: verdict.provider.status, providerErrorClass: verdict.provider.errorClass, budgetExceeded: false });
          skipReason = stop === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "provider_failure";
          break;
        }
        const pass = (verdict.scope === "in_scope" || verdict.scope === "mixed") && verdict.openQuestionSent === testCase.openQuestion;
        results.push({
          id: testCase.id,
          openQuestion: testCase.openQuestion,
          scope: verdict.scope,
          reasonCode: verdict.reasonCode,
          openQuestionSent: verdict.openQuestionSent,
          pass,
          falseRefusal: verdict.scope === "unclear" || verdict.scope === "out_of_scope",
        });
      } finally {
        environment.close();
      }
    }
  }
  // The false-refusal rate is over the cases that returned a verdict; a `failed` case (no verdict) is excluded and counted.
  const verdictCases = results.filter((entry) => entry.scope !== "failed");
  const refused = verdictCases.filter((entry) => entry.falseRefusal).length;
  return {
    status: skipReason === undefined ? "run" : "skipped",
    ...(skipReason === undefined ? {} : { skipReason }),
    requestBudget,
    requestsUsed: options.requestsUsed?.() ?? 0,
    cases: results,
    failedCases: results.length - verdictCases.length,
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
      "| Case | Open question | Scope | Reason | Code sent | Result |",
      "|---|---|---|---|---|---|",
      ...report.cases.map((entry) => `| ${entry.id} | ${entry.openQuestion} | ${entry.scope} | ${entry.reasonCode} | ${entry.openQuestionSent ?? "none"} | ${entry.pass ? "PASS" : "FAIL"} |`),
    ]),
    "",
  ];
  return lines;
}

/** The closed intent type is re-exported only so a fake client in a test can script an in-scope verdict without its own import. */
export type { ConciergeIntent };
