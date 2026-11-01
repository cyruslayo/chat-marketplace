import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LocalGuestApp, type CardCheckoutFailedEvent } from "../../apps/local-guest/src/shortlet-app.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import { ShortletAssistantRuntime } from "./assistant-runtime-host.js";
import { BudgetedModelClient, ModelCallBudget } from "../../apps/local-guest/src/assistant/model-call-budget.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantDomainPack } from "../../apps/local-guest/src/assistant/assistant-platform.js";
import { ModelQuotaGuardClient } from "../../apps/local-guest/src/assistant/model-quota-guard.js";
import { SqliteModelRequestQuota } from "../../packages/platform-core/src/model-request-quota.js";
import { clientWith, completion, type CapturedRequest } from "./openai-compatible-client.js";

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
  /** The SQLite file the environment opened, when the fixture was opened over one (needed for a true restart). */
  readonly databasePath?: string;
  /** The openNode configuration, without the database path, so a restart composes the same environment. */
  readonly openConfig?: Omit<NonNullable<Parameters<typeof LocalGuestEnvironment.openNode>[0]>, "databasePath">;
  close(): void;
}

/** One offline app with the real classifier and planner path, wired to a scripted model client. */
/** A live-like clock (27 Oct 2026, Africa/Lagos), so a December stay is inside the 90-day booking horizon (ADR 0055). */
export const LIVE_LIKE_CLOCK = (): Date => new Date("2026-10-27T10:00:00Z");

/**
 * The staging-like guest: no phone or email, as the staging Durable Object starts it (shortlet-pilot-do.ts), so a journey
 * meets the same contact-details step a live guest does. Shared by every staging-like environment in the assistant tests.
 */
export const STAGING_GUEST_CONFIG = { initialGuestPhoneNumber: null, initialGuestContactEmail: null } as const;

export function datedFixture(model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[], options: { readonly clock?: () => Date; readonly stagingGuest?: boolean; readonly paystackClient?: NonNullable<Parameters<typeof LocalGuestEnvironment.openNode>[0]>["paystackClient"]; /** The deployment composition (ADR 0105): demo off and production by default. */ readonly composition?: { readonly demo?: boolean; readonly deployment?: "production" | "staging" } } = {}): DatedFixture {
  const directory = mkdtempSync(join(tmpdir(), "date-literal-"));
  const openConfig = {
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.paystackClient ? { paystackClient: options.paystackClient } : {}),
    ...(options.stagingGuest ? STAGING_GUEST_CONFIG : {}),
    ...(options.composition ?? {}),
  };
  const databasePath = join(directory, "guest.sqlite");
  const environment = LocalGuestEnvironment.openNode({ databasePath, ...openConfig });
  return { ...wireDatedApp(environment, model, diagnostics), databasePath, openConfig, close() { environment.close(); rmSync(directory, { recursive: true, force: true }); } };
}

/**
 * A true restart (ADR 0106 cold restore): the previous environment is closed, then a NEW LocalGuestEnvironment is opened
 * over the same SQLite file. The new environment owns a new ConditionalOfferManager and an empty offer cache, as a Worker
 * rebuilt after eviction does. `clock` overrides the clock for the restarted process (for example, past an offer's deadline).
 */
export function trueRestartedDatedApp(previous: DatedFixture, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[], overrides: { readonly clock?: () => Date } = {}): DatedFixture {
  if (previous.databasePath === undefined || previous.openConfig === undefined) throw new Error("trueRestartedDatedApp needs a fixture opened over a database file");
  previous.environment.close();
  const environment = LocalGuestEnvironment.openNode({ ...previous.openConfig, ...(overrides.clock ? { clock: overrides.clock } : {}), databasePath: previous.databasePath });
  const directory = dirname(previous.databasePath);
  return { ...wireDatedApp(environment, model, diagnostics), databasePath: previous.databasePath, openConfig: previous.openConfig, close() { environment.close(); rmSync(directory, { recursive: true, force: true }); } };
}

/**
 * A fresh app and runtime over the same guest store, as after an application restart. Threads are reloaded only
 * from the persisted projection, never from the previous process's memory.
 */
export function restartedDatedApp(previous: DatedFixture, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]): Omit<DatedFixture, "close"> {
  return wireDatedApp(previous.environment, model, diagnostics);
}

export function wireDatedApp(environment: LocalGuestEnvironment, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[], additionalPacks?: readonly AssistantDomainPack[], appOptions: { readonly paystackCheckoutTimeoutMs?: number; readonly onCardCheckoutFailed?: (event: CardCheckoutFailedEvent) => void } = {}):Omit<DatedFixture, "close"> {
  const budget = new ModelCallBudget(10, () => environment.clock());
  const quota = new SqliteModelRequestQuota(environment.database, { clock: environment.clock, dailyTenantLimit: 3_000, hourlyGuestLimit: 60 });
  const identity = { tenantId: environment.config.tenantId, guestId: environment.config.guestId };
  const guarded = new ModelQuotaGuardClient(model, quota, identity);
  const runtime = new ShortletAssistantRuntime(environment, new BudgetedModelClient(guarded, budget), {
    onDiagnostic: (event) => diagnostics?.push(event),
    additionalPacks,
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget, ...appOptions });
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

/**
 * One scripted in-scope turn: the classifier slots and intents the guest's text supports, and the planner's one tool call
 * (a `search_stays` search, or any other tool such as `get_unit_details`).
 */
export interface ScriptedTurn {
  readonly slots: Partial<ScopeSlots>;
  readonly intents?: readonly string[];
  readonly search?: Record<string, unknown>;
  readonly tool?: { readonly name: string; readonly args: Record<string, unknown> };
}

/**
 * A scripted OpenRouter-compatible model: each listed guest message gets its classifier verdict and one planner tool call.
 * Every planner request is appended to `planner` so tests can assert what the planner was shown.
 */
export function scriptedPlanner(turns: Readonly<Record<string, ScriptedTurn>>, planner: CapturedRequest[] = []) {
  return clientWith((request) => {
    if (isScopeRequest(request)) {
      const turn = turns[classifiedMessage(request)];
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents)) });
    }
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    const text = latestUserText(request);
    const turn = text === undefined ? undefined : turns[text];
    planner.push(request);
    if (turn?.search) return searchToolCall(`search-${text?.length ?? 0}`, turn.search);
    if (turn?.tool) return completion({ tool_calls: [{ id: `tool-${text?.length ?? 0}`, type: "function", function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) } }] });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
}

/** The first Button action on a surface, as the browser would send it (the guest taps the first primary control). */
export function firstButtonAction(surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }): { readonly name: string; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string; readonly context: Record<string, unknown> } {
  let found: { readonly name: string; readonly context: Record<string, unknown> } | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const record = node as Record<string, unknown>;
    const event = (record.action as { readonly event?: { readonly name?: unknown; readonly context?: unknown } } | undefined)?.event;
    if (record.component === "Button" && event && typeof event.name === "string" && event.context !== null && typeof event.context === "object") {
      found = { name: event.name, context: event.context as Record<string, unknown> };
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(surface.a2uiMessages);
  if (found === undefined) throw new Error(`surface ${surface.surfaceId} has no Button action`);
  return { ...found, surfaceId: surface.surfaceId, sourceComponentId: "journey-test", timestamp: new Date().toISOString() };
}
