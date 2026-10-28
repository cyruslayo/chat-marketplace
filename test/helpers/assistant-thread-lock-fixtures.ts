import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LocalGuestApp, type GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantDiagnosticEvent } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantTurnRecord } from "../../apps/local-guest/src/assistant/assistant-turn-record.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { ShortletAssistantRuntime } from "./assistant-runtime-host.js";
import { ModelCallBudget, BudgetedModelClient } from "../../apps/local-guest/src/assistant/model-call-budget.js";
import { definitionOf, PROPOSE_REQUEST, SEARCH_IKOYI, journeyScriptedModel, type RecordedJourneyDefinition } from "./assistant-recordings.js";
import { LIVE_LIKE_CLOCK, STAGING_GUEST_CONFIG, firstButtonAction, scriptedPlanner, wireDatedApp, type ScriptedTurn } from "./guest-date-fixtures.js";
import { DirectPaystackClient, type PaystackHttpFetcher } from "../../packages/platform-core/src/payments/index.js";

// Shared fixtures for the thread-lock tests (issue 06). One definition, used by the Node tests and the session-level tests.

export const THREAD = "g-d1a0000601";
export const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";
export const PROPOSE_TEXT = "Request the first one.";
/** The typed turn held at the planner: a unit-detail read that runs one planner round after its tool call. */
export const HELD_TEXT = "Open the first one.";

/** The recorded confirmation journey, extended with the held planner turn. */
export function lockDefinition(threadId: string): RecordedJourneyDefinition {
  return {
    ...definitionOf("confirmation-cancelled"),
    threadId,
    guestTurns: [
      { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
      { text: PROPOSE_TEXT, planner: PROPOSE_REQUEST },
      { text: HELD_TEXT, planner: { tool: "get_unit_details", args: { stayRef: "stay-1" } } },
    ],
  };
}

/** The scripted model every lock test uses: the journey's answers, with the held text gated. */
export function lockModel(holdText: string = HELD_TEXT): { model: AssistantModelClient; gate: Gate } {
  return gatedModel(journeyScriptedModel(lockDefinition(THREAD)), holdText);
}

export interface Gate {
  /** Resolves when the held planner request has started and is waiting. */
  readonly reached: Promise<void>;
  /** Lets the held planner request continue. */
  release(): void;
  /** Runs when the test releases the held request, before it continues (a deadline passing, for example). */
  beforeRelease?: () => void;
  /** When set, the held request throws instead of answering. */
  failOnRelease?: Error;
  /** When set, the held request never resolves and ignores its abort signal (a stuck provider). */
  neverResolve?: boolean;
}

/** A model that holds the first planner request for `holdText` until the test releases it. Every other request passes through. */
export function gatedModel(inner: AssistantModelClient, holdText: string): { model: AssistantModelClient; gate: Gate } {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  let holding = false;
  const gate: Gate = { reached, release: () => release() };
  const model: AssistantModelClient = {
    supportsProviderAttemptReservation: inner.supportsProviderAttemptReservation,
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const last = request.history.at(-1);
      if (!holding && request.structuredOutput?.name !== "concierge_scope" && last?.role === "user" && last.text === holdText) {
        holding = true;
        reach();
        if (gate.neverResolve) await new Promise<never>(() => undefined);
        await released;
        gate.beforeRelease?.();
        if (gate.failOnRelease) throw gate.failOnRelease;
      }
      return inner.generate(request);
    },
  };
  return { model, gate };
}

export interface LockWorld {
  readonly environment: LocalGuestEnvironment;
  readonly app: LocalGuestApp;
  readonly runtime: ShortletAssistantRuntime;
  readonly records: AssistantTurnRecord[];
  readonly diagnostics: AssistantDiagnosticEvent[];
}

/** One application and runtime over the environment. The records and diagnostics are the runtime's own output. */
export function worldOver(environment: LocalGuestEnvironment, model: AssistantModelClient, options: { readonly turnDeadlineMs?: number } = {}): LockWorld {
  const records: AssistantTurnRecord[] = [];
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const budget = new ModelCallBudget(50, () => environment.clock());
  const runtime = new ShortletAssistantRuntime(environment, new BudgetedModelClient(model, budget), {
    onTurnRecord: (record) => records.push(record),
    onDiagnostic: (event) => diagnostics.push(event),
    modelName: "openai/gpt-6-luna",
    ...(options.turnDeadlineMs === undefined ? {} : { turnDeadlineMs: options.turnDeadlineMs }),
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget });
  return { environment, app, runtime, records, diagnostics };
}

/** A guest with a phone, on the staging-like clock, so a Booking Request can be confirmed. */
export function phoneEnvironment(clock: () => Date = LIVE_LIKE_CLOCK): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock });
}

export function successOf(result: GuestTurnResult, label: string) {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

export function codeOf(result: GuestTurnResult): string | undefined {
  return result.ok ? undefined : result.code;
}

export function pendingId(world: { readonly runtime: ShortletAssistantRuntime }, threadId: string): string | undefined {
  return world.runtime.getThread(threadId).taskState.pendingAction?.id;
}

/** The confirm event of the live pending-action card, as the guest's button sends it. */
export function confirmEventFor(world: { readonly runtime: ShortletAssistantRuntime }, threadId: string, card: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }) {
  const live = firstButtonAction(card);
  return { ...live, name: ASSISTANT_CONFIRM_ACTION_EVENT, context: { ...live.context, actionId: pendingId(world, threadId) } };
}

/** Searches, then proposes a Booking Request on the thread. Returns the proposal's pending-action card. */
export async function proposeOn(world: LockWorld, threadId: string) {
  world.app.getState(threadId);
  successOf(await world.app.handleTurn(threadId, SEARCH_TEXT), "search");
  const proposal = successOf(await world.app.handleTurn(threadId, PROPOSE_TEXT), "propose");
  const card = proposal.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(card, "the proposal shows its pending-action card");
  return card;
}

/** A real open proposal, built on its own thread, for the commit-level tests (the object the runtime holds). */
export async function sampleProposal() {
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition("g-d1a0000699")));
  await proposeOn(world, "g-d1a0000699");
  const action = world.runtime.getThread("g-d1a0000699").taskState.pendingAction;
  assert.ok(action, "a proposal exists");
  return action;
}

// ---- Paystack checkout (issue 06, gap M12): a staging-like guest, a Paystack provider the test can hold, and the steps to checkout. ----

export const CHECKOUT_STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
export const CHECKOUT_PHONE = "+234 801 234 5678";
export const CHECKOUT_EMAIL = "guest@example.com";
const CHECKOUT_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const CHECKOUT_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  [CHECKOUT_STAY_TEXT]: { slots: CHECKOUT_SEARCH, search: CHECKOUT_SEARCH },
};

/** The Paystack initialize call the test holds. Armed, the next initialize call starts, reports itself, and waits for release. */
export interface ProviderGate {
  armed: boolean;
  /** Resolves when a held initialize call has started and is waiting. */
  readonly reached: Promise<void>;
  /** Lets the held call continue (or fail, when failOnRelease is set). */
  release(): void;
  /** When set, the held call rejects on release instead of answering. */
  failOnRelease?: Error;
}

export interface CheckoutWorld {
  readonly environment: LocalGuestEnvironment;
  readonly gate: ProviderGate;
}

/** A staging-like environment (no seeded phone or email) whose Paystack provider the test controls. */
export function checkoutWorld(clock: () => Date = LIVE_LIKE_CLOCK): CheckoutWorld {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  const gate: ProviderGate = { armed: false, reached, release: () => release() };
  const fetcher: PaystackHttpFetcher = async (_url, init) => {
    const parsed: unknown = JSON.parse(init.body ?? "{}");
    const reference = parsed !== null && typeof parsed === "object" ? (parsed as { readonly reference?: unknown }).reference : undefined;
    if (gate.armed) {
      gate.armed = false;
      reach();
      await released;
      if (gate.failOnRelease) throw gate.failOnRelease;
    }
    return { status: 200, async json() { return { status: true, data: { authorization_url: "https://checkout.paystack.com/synthetic", reference } }; } };
  };
  const paystackClient = new DirectPaystackClient({ secretKey: "sk_test_lock_synthetic", environment: "test", callbackBaseUrl: "https://lock.example.test" }, fetcher);
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock, paystackClient, ...STAGING_GUEST_CONFIG });
  return { environment, gate };
}

/** A new application over the same store, loaded as a page load does, before the next event is sent (a cold restore). */
export function coldCheckoutApp(world: CheckoutWorld, threadId: string) {
  const restored = wireDatedApp(world.environment, scriptedPlanner(CHECKOUT_SCRIPT).client);
  restored.app.getState(threadId);
  return restored;
}

/** The first Button action on each surface, sent after a cold restore, as the guest's tap does. */
export async function tapFirst(world: CheckoutWorld, threadId: string, surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }) {
  return coldCheckoutApp(world, threadId).app.handleEventAsync(threadId, firstButtonAction(surface));
}

/** The Button action on a surface that starts the Paystack checkout, when the surface has one. */
export function checkoutActionOn(surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }): { readonly name: string; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string; readonly context: Record<string, unknown> } | undefined {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const record = node as Record<string, unknown>;
    const event = (record.action as { readonly event?: { readonly name?: unknown } } | undefined)?.event;
    if (typeof event?.name === "string") names.push(event.name);
    Object.values(record).forEach(walk);
  };
  walk(surface.a2uiMessages);
  if (!names.includes("shortlet.card-payment.initialize-checkout")) return undefined;
  return { ...firstCheckoutButton(surface.a2uiMessages), surfaceId: surface.surfaceId, sourceComponentId: "lock-test", timestamp: new Date().toISOString() };
}

function firstCheckoutButton(messages: readonly unknown[]): { readonly name: string; readonly context: Record<string, unknown> } {
  let found: { readonly name: string; readonly context: Record<string, unknown> } | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const record = node as Record<string, unknown>;
    const event = (record.action as { readonly event?: { readonly name?: unknown; readonly context?: unknown } } | undefined)?.event;
    if (event && event.name === "shortlet.card-payment.initialize-checkout" && event.context !== null && typeof event.context === "object") {
      found = { name: event.name, context: event.context as Record<string, unknown> };
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(messages);
  if (found === undefined) throw new Error("no checkout button");
  return found;
}

/**
 * Drives one guest from a fresh search to the payment surface that starts Paystack checkout: search, View, Request to Book,
 * phone, Send, operator acceptance, Accept offer, and the email the checkout asks for. Every step is a cold restore.
 */
export async function reachCheckout(world: CheckoutWorld, threadId: string) {
  const search = await wireDatedApp(world.environment, scriptedPlanner(CHECKOUT_SCRIPT).client).app.handleTurn(threadId, CHECKOUT_STAY_TEXT);
  let surface = successOf(search, "search").surfaces[0]!;
  const detail = successOf(await tapFirst(world, threadId, surface), "View");
  surface = detail.surfaces[0]!;
  const draft = successOf(await tapFirst(world, threadId, surface), "Request to Book");
  const phoneAsk = successOf(await tapFirst(world, threadId, draft.surfaces[0]!), "Review request");
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
  const saved = successOf(await coldCheckoutApp(world, threadId).app.handleEventAsync(threadId, { ...phoneSave, context: { ...phoneSave.context, contactValue: CHECKOUT_PHONE } }), "Save phone number");
  const sent = successOf(await tapFirst(world, threadId, saved.surfaces[0]!), "Send booking request");
  world.environment.simulateOperatorAcceptance(sent.surfaces[0]!.surfaceId.split(":").at(-1)!);
  const offer = coldCheckoutApp(world, threadId).app.getState(threadId);
  assert.ok(offer, "the offer is readable after acceptance");
  const payment = successOf(await tapFirst(world, threadId, offer.surfaces[0]!), "Accept offer");
  // The checkout needs the guest's email on file before the provider is called (the contact application owns it, as the
  // guest's own email save does). Saved here, through that application, so the next event is the checkout itself.
  world.environment.guestContactApp.submitEmail({ contactEmail: CHECKOUT_EMAIL }, world.environment.guestPrincipal());
  return payment;
}
