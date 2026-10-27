import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../../apps/local-guest/src/shortlet-app.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import { BudgetedModelClient, ModelCallBudget } from "../../apps/local-guest/src/assistant/model-call-budget.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { ModelQuotaGuardClient } from "../../apps/local-guest/src/assistant/model-quota-guard.js";
import { SqliteModelRequestQuota } from "../../packages/platform-core/src/model-request-quota.js";
import { completion, type CapturedRequest } from "./openai-compatible-client.js";

/** The default fixture clock (Africa/Lagos 2026-09-03 11:00). Every date literal test resolves against it. */
export const FIXTURE_NOW = new Date("2026-09-03T10:00:00Z");

export const OPENROUTER = { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" } as const;

export interface ScopeSlots {
  readonly city: string | null;
  readonly neighbourhood: string | null;
  readonly bedrooms: number | null;
  readonly nights: number | null;
  readonly guests: number | null;
  readonly checkIn: string | null;
  readonly checkOut: string | null;
}

export const EMPTY_SLOTS: ScopeSlots = { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null };

/** A valid in-scope classifier verdict (ADR 0106 advisory verdict shape). */
export function scopeVerdict(slots: Partial<ScopeSlots> = {}, intents: readonly string[] = ["search"]) {
  return { scope: "in_scope", risk: "ordinary", intents, reasonCode: "supported", slots: { ...EMPTY_SLOTS, ...slots } };
}

export function isScopeRequest(request: CapturedRequest): boolean {
  return (request.body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name === "concierge_scope";
}

/** The latest user message text in a planner or classifier request, or undefined when the request has none. */
export function latestUserText(request: CapturedRequest): string | undefined {
  const messages = request.body.messages as readonly { readonly role: string; readonly content?: unknown }[];
  const content = messages.filter((message) => message.role === "user").at(-1)?.content;
  return typeof content === "string" ? content : undefined;
}

/** The guest message the classifier judges: its user envelope is JSON with a \"message\" field (scope-classifier.ts). */
export function classifiedMessage(request: CapturedRequest): string {
  const raw = latestUserText(request) ?? "";
  try {
    const parsed = JSON.parse(raw) as { readonly message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : raw;
  } catch {
    return raw;
  }
}

export function lastRoleIsTool(request: CapturedRequest): boolean {
  const messages = request.body.messages as readonly { readonly role: string }[];
  return messages.at(-1)?.role === "tool";
}

export function searchToolCall(id: string, args: Record<string, unknown>) {
  return completion({ tool_calls: [{ id, type: "function", function: { name: "search_stays", arguments: JSON.stringify(args) } }] });
}

export interface DatedFixture {
  readonly environment: LocalGuestEnvironment;
  readonly budget: ModelCallBudget;
  readonly runtime: AssistantRuntime;
  readonly app: LocalGuestApp;
  close(): void;
}

/** One offline app with the real classifier and planner path, wired to a scripted model client. */
export function datedFixture(model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]): DatedFixture {
  const directory = mkdtempSync(join(tmpdir(), "date-literal-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  return { ...wireDatedApp(environment, model, diagnostics), close() { environment.close(); rmSync(directory, { recursive: true, force: true }); } };
}

/**
 * A fresh app and runtime over the same guest store, as after an application restart. Threads are reloaded only
 * from the persisted projection, never from the previous process's memory.
 */
export function restartedDatedApp(previous: DatedFixture, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]): Omit<DatedFixture, "close"> {
  return wireDatedApp(previous.environment, model, diagnostics);
}

function wireDatedApp(environment: LocalGuestEnvironment, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]): Omit<DatedFixture, "close"> {
  const budget = new ModelCallBudget(10, () => environment.clock());
  const quota = new SqliteModelRequestQuota(environment.database, { clock: environment.clock, dailyTenantLimit: 3_000, hourlyGuestLimit: 60 });
  const identity = { tenantId: environment.config.tenantId, guestId: environment.config.guestId };
  const guarded = new ModelQuotaGuardClient(model, quota, identity);
  const runtime = new AssistantRuntime(environment, new BudgetedModelClient(guarded, budget), {
    onDiagnostic: (event) => diagnostics?.push(event),
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget });
  return { environment, budget, runtime, app };
}

/** The discovery artifact the runtime holds for a thread, narrowed to the fields the guest tests read. */
export function runtimeDiscoveryArtifact(runtime: AssistantRuntime, threadId: string): { readonly id: string; readonly facts: { readonly results: readonly { readonly id: string }[] } } | undefined {
  const artifact: unknown = runtime.getThread(threadId).discoveryArtifact;
  if (typeof artifact !== "object" || artifact === null) return undefined;
  const candidate = artifact as { readonly id?: unknown; readonly facts?: { readonly results?: unknown } };
  if (typeof candidate.id !== "string" || !Array.isArray(candidate.facts?.results)) return undefined;
  return candidate as { readonly id: string; readonly facts: { readonly results: readonly { readonly id: string }[] } };
}
