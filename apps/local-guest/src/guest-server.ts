import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { A2UIServerMessage, JsonObject } from "@weaver/core";
import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import {
  discoveryArtifactToA2UI,
  createWeaverWebAgentAdapter,
  bookingRequestArtifactToA2UI,
  conditionalOfferArtifactToA2UI,
  cardPaymentArtifactToA2UI,
  bookingContractArtifactToA2UI,
  unitDetailToA2UI,
  REQUEST_TO_BOOK_EVENT,
  type DiscoveryArtifactProjection,
} from "../../../apps/web-agent/src/index.js";
import {
  resolveDiscoveryServerEvent,
} from "../../../apps/web/src/discovery-actions.js";
import { resolveConditionalOfferServerEvent } from "../../../apps/web/src/conditional-offer-actions.js";
import { resolveCardPaymentServerEvent } from "../../../apps/web/src/card-payment-actions.js";
import {
  LocalGuestEnvironment,
  LOCAL_GUEST_PORT,
  resetLocalGuestFixture,
  type LocalGuestFixtureConfig,
} from "./fixture.js";
import { interpretStayRequest } from "./concierge.js";
import { createGeminiConciergeClient, handleGeminiTurn, type GeminiConciergeClient } from "./gemini-concierge.js";
import type { Content } from "@google/genai";

export interface GuestSurfacePayload {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly A2UIServerMessage[];
}

export interface GuestTurnSuccess {
  readonly ok: true;
  readonly messages: readonly string[];
  readonly surfaces: readonly GuestSurfacePayload[];
}

export interface GuestRejection {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type GuestTurnResult = GuestTurnSuccess | GuestRejection;

const DISCOVERY_STAGE = "discovery";
const UNIT_STAGE = "unit";
const REQUEST_STAGE = "request";
const OFFER_STAGE = "offer";
const PAYMENT_STAGE = "payment";
const BOOKING_STAGE = "booking";

/**
 * Explicit local allow-list of Weaver-generated action events (ADR-0072).
 * Everything else fails closed.
 */
const EVENT_STAGE_ALLOW_LIST: Readonly<Record<string, string>> = Object.freeze({
  "shortlet.discovery.view-unit": DISCOVERY_STAGE,
  [REQUEST_TO_BOOK_EVENT]: UNIT_STAGE,
  "shortlet.conditional-offer.accept": OFFER_STAGE,
  "shortlet.card-payment.initialize-checkout": PAYMENT_STAGE,
});

const THREAD_ID_PATTERN = /^g-[a-f0-9-]{6,64}$/;

interface GuestThreadState {
  readonly threadId: string;
  readonly geminiHistory: Content[];
  discoveryArtifact: DiscoveryArtifactProjection | null;
  discoverySurfaceId: string;
  unitDetail: { readonly unitId: string; readonly artifactId: string } | null;
  requestId: string | null;
  offerId: string | null;
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  geminiLastSearch: { readonly surfaceId: string; readonly a2uiMessages: readonly A2UIServerMessage[] } | null;
}

export class LocalGuestApp {
  #environment: LocalGuestEnvironment;
  readonly #threads = new Map<string, GuestThreadState>();

  readonly #geminiClient: GeminiConciergeClient | null;

  constructor(environment: LocalGuestEnvironment, options: { readonly geminiClient?: GeminiConciergeClient } = {}) {
    this.#environment = environment;
    this.#geminiClient = options.geminiClient ?? null;
  }

  get environment(): LocalGuestEnvironment {
    return this.#environment;
  }

  async handleTurn(threadId: string, text: string): Promise<GuestTurnResult> {
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return { ok: false, code: "INVALID_THREAD", message: "Unknown conversation." };
    }
    const thread = this.#threads.get(threadId) ?? this.#createThread(threadId);
    if (this.#geminiClient) {
      try {
        const live = await handleGeminiTurn({
          client: this.#geminiClient,
          history: thread.geminiHistory,
          text,
          demoCheckIn: this.#environment.config.demoCheckIn,
          now: this.#environment.clock(),
          search: (filters) => {
            const adapter = createWeaverWebAgentAdapter({
              query: { search: (query) => this.#environment.discoveryQuery.search(query) },
              createSurfaceId: () => thread.discoverySurfaceId,
            });
            const result = adapter.search({ ...filters });
            thread.discoveryArtifact = result.artifact;
            thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
            thread.geminiLastSearch = result;
            return {
              resultCount: result.artifact.facts.results.length,
              location: filters.location,
              ...(filters.neighbourhood ? { neighbourhood: filters.neighbourhood } : {}),
              checkIn: filters.checkIn,
              checkOut: filters.checkOut,
            };
          },
        });
        if (live.kind === "clarify") return { ok: true, messages: [live.reply], surfaces: [] };
        const result = thread.geminiLastSearch;
        if (!result) throw new Error("Gemini search did not produce a discovery surface");
        return { ok: true, messages: [live.reply], surfaces: [{ surfaceId: result.surfaceId, a2uiMessages: result.a2uiMessages }] };
      } catch {
        return { ok: false, code: "CONCIERGE_UNAVAILABLE", message: "The concierge is temporarily unavailable. Please try again." };
      }
    }

    const interpretation = interpretStayRequest(text, {
      demoCheckIn: this.#environment.config.demoCheckIn,
      demoCheckOut: this.#environment.config.demoCheckOut,
    });

    if (interpretation.kind === "clarify") {
      return { ok: true, messages: [interpretation.reply], surfaces: [] };
    }

    const adapter = createWeaverWebAgentAdapter({
      query: { search: (filters) => this.#environment.discoveryQuery.search(filters) },
      createSurfaceId: () => thread.discoverySurfaceId,
    });
    const result = adapter.search({ ...interpretation.filters });
    thread.discoveryArtifact = result.artifact;
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);

    return {
      ok: true,
      messages: [
        `I found ${result.artifact.facts.results.length} eligible place${result.artifact.facts.results.length === 1 ? "" : "s"} in ${interpretation.filters.location} for your stay ${interpretation.filters.checkIn} to ${interpretation.filters.checkOut}. You can view the details below.`,
      ],
      surfaces: [{ surfaceId: result.surfaceId, a2uiMessages: result.a2uiMessages }],
    };
  }

  handleEvent(threadId: string, payload: unknown): GuestTurnResult {
    const event = readEventPayload(payload);
    if (!event) {
      return { ok: false, code: "INVALID_EVENT", message: "The action could not be processed." };
    }
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return { ok: false, code: "INVALID_THREAD", message: "Unknown conversation." };
    }
    const thread = this.#threads.get(threadId);
    if (!thread) {
      return { ok: false, code: "UNKNOWN_THREAD", message: "Unknown conversation." };
    }

    const stage = EVENT_STAGE_ALLOW_LIST[event.name];
    if (!stage) {
      return { ok: false, code: "UNSUPPORTED_EVENT", message: "That action is not available." };
    }
    const activeSurfaceId = thread.activeSurfaces.get(stage);
    if (!activeSurfaceId || activeSurfaceId !== event.surfaceId) {
      return {
        ok: false,
        code: "STALE_SURFACE",
        message: "That action is no longer available; please use the current options.",
      };
    }

    switch (event.name) {
      case "shortlet.discovery.view-unit":
        return this.#handleViewUnit(thread, event);
      case REQUEST_TO_BOOK_EVENT:
        return this.#handleRequestToBook(thread, event);
      case "shortlet.conditional-offer.accept":
        return this.#handleOfferAccept(thread, event);
      case "shortlet.card-payment.initialize-checkout":
        return this.#handleCardCheckout(thread, event);
      default:
        return { ok: false, code: "UNSUPPORTED_EVENT", message: "That action is not available." };
    }
  }

  reset(): void {
    this.#threads.clear();
    const config = this.#environment.config;
    this.#environment.close();
    resetLocalGuestFixture(config.databasePath);
    this.#environment = new LocalGuestEnvironment(config);
  }

  #createThread(threadId: string): GuestThreadState {
    const thread: GuestThreadState = {
      threadId,
      discoveryArtifact: null,
      discoverySurfaceId: `thread-${threadId}:discovery:results`,
      unitDetail: null,
      requestId: null,
      offerId: null,
      activeSurfaces: new Map(),
      supersededSurfaces: new Set(),
      geminiHistory: [],
      geminiLastSearch: null,
    };
    this.#threads.set(threadId, thread);
    return thread;
  }

  #supersede(thread: GuestThreadState, stage: string): void {
    const surfaceId = thread.activeSurfaces.get(stage);
    if (surfaceId) {
      thread.supersededSurfaces.add(surfaceId);
      thread.activeSurfaces.delete(stage);
    }
  }

  #handoff(event: GuestEventPayload): WebServerEventHandoff {
    return {
      message: {
        version: "v0.9.1",
        action: {
          name: event.name,
          surfaceId: event.surfaceId,
          sourceComponentId: event.sourceComponentId,
          timestamp: event.timestamp,
          context: event.context ?? ({} as JsonObject),
        },
      },
    };
  }

  #handleViewUnit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    if (!artifact) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No search is active for this conversation." };
    }
    // Server-side validation against the authoritative discovery artifact;
    // arbitrary client-supplied Unit IDs fail closed here.
    const authoritative = {
      id: artifact.id,
      kind: artifact.kind,
      schemaVersion: artifact.schemaVersion,
      projectionVersion: artifact.projectionVersion,
      actions: artifact.actions
        .filter((action) => action.type === "view-unit")
        .map((action) => ({ type: "view-unit" as const, unitId: action.unitId, conventionalRoute: action.conventionalRoute })),
    };
    const resolved = resolveDiscoveryServerEvent({ event: this.#handoff(event), artifact: authoritative });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message };
    }
    const unit = artifact.facts.results.find((candidate) => candidate.id === resolved.effect.unitId);
    if (!unit) {
      return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "That unit is not available." };
    }

    thread.unitDetail = { unitId: unit.id, artifactId: artifact.id };
    const surfaceId = `thread-${thread.threadId}:unit:detail`;
    // ADR-0074: selecting a Unit supersedes the discovery projection and its
    // generated actions; the linear demo has no valid back-navigation state.
    this.#supersede(thread, DISCOVERY_STAGE);
    thread.activeSurfaces.set(UNIT_STAGE, surfaceId);
    return {
      ok: true,
      messages: [`Here are the details for ${unit.title}.`],
      surfaces: [
        {
          surfaceId,
          a2uiMessages: unitDetailToA2UI({
            unit,
            ...this.#stayDatesFor(thread),
            surfaceId,
            action: { artifactId: artifact.id, unitId: unit.id, projectionVersion: artifact.projectionVersion },
          }),
        },
      ],
    };
  }

  #handleRequestToBook(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const detail = thread.unitDetail;
    const context = event.context;
    if (!detail || !context || typeof context !== "object"
      || (context as Record<string, unknown>).artifactId !== detail.artifactId
      || (context as Record<string, unknown>).unitId !== detail.unitId) {
      return { ok: false, code: "INVALID_CONTEXT", message: "That request is no longer valid." };
    }
    if (thread.requestId || thread.offerId) {
      return { ok: false, code: "STALE_SURFACE", message: "A booking request already exists for this conversation." };
    }

    const environment = this.#environment;
    const guest: CommandPrincipal = environment.guestPrincipal();
    const draft = environment.bookingRequestApp.createDraft(
      {
        unitId: detail.unitId,
        primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
        occupants: environment.demoOccupants(this.#partySizeFor(thread)),
        selfBookingAttestation: environment.selfBookingAttestation(),
        ...this.#stayDatesFor(thread),
      },
      guest,
    );
    const disclosed = environment.bookingRequestApp.disclose(draft.draftId, guest);
    thread.requestId = disclosed.requestId;

    // Local operator simulation through the real authorized representative path.
    const { offerId } = environment.simulateOperatorAcceptance(disclosed.requestId);
    thread.offerId = offerId;

    const requestSurfaceId = `thread-${thread.threadId}:request:${disclosed.requestId}`;
    const offerSurfaceId = `thread-${thread.threadId}:offer:${offerId}`;
    this.#supersede(thread, UNIT_STAGE);
    thread.activeSurfaces.set(REQUEST_STAGE, requestSurfaceId);
    thread.activeSurfaces.set(OFFER_STAGE, offerSurfaceId);

    const requestArtifact = environment.bookingRequestApp.getArtifact(disclosed.requestId, guest);
    const offerArtifact = environment.conditionalOfferApp.getArtifact(offerId, guest);

    return {
      ok: true,
      messages: ["The host has accepted your request. Here is your booking offer."],
      surfaces: [
        { surfaceId: requestSurfaceId, a2uiMessages: bookingRequestArtifactToA2UI({ artifact: requestArtifact, surfaceId: requestSurfaceId }) },
        { surfaceId: offerSurfaceId, a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId: offerSurfaceId }) },
      ],
    };
  }

  #handleOfferAccept(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No offer is active for this conversation." };
    }
    const resolved = resolveConditionalOfferServerEvent({
      event: this.#handoff(event),
      application: this.#environment.conditionalOfferApp,
      principal: this.#environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    const offerId = thread.offerId;
    const paymentSurfaceId = `thread-${thread.threadId}:payment:${offerId}`;
    this.#supersede(thread, OFFER_STAGE);
    thread.activeSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);

    const paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
    return {
      ok: true,
      messages: ["Offer accepted. Complete the secure card payment to confirm your booking."],
      surfaces: [
        { surfaceId: paymentSurfaceId, a2uiMessages: cardPaymentArtifactToA2UI({ artifact: paymentArtifact, surfaceId: paymentSurfaceId }) },
      ],
    };
  }

  #handleCardCheckout(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No payment is active for this conversation." };
    }
    const environment = this.#environment;
    const resolved = resolveCardPaymentServerEvent({
      event: this.#handoff(event),
      application: environment.cardPaymentApp,
      principal: environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    let session = environment.cardPaymentApp.manager.getCheckoutSession(thread.offerId);
    if (!session) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No checkout session is active." };
    }
    let outcome = environment.cardPaymentApp.verifyAndConfirm(session.pspReference, environment.systemPrincipal());
    // The launch deposit is a separate actual charge (ADR-0016). The local
    // demo immediately completes that second deterministic checkout so the
    // browser journey can demonstrate final confirmation in one interaction.
    if (outcome.outcome === "deposit_required") {
      session = environment.cardPaymentApp.initializeCheckout(thread.offerId, environment.guestPrincipal());
      outcome = environment.cardPaymentApp.verifyAndConfirm(session.pspReference, environment.systemPrincipal());
    }
    if (outcome.outcome !== "confirmed") {
      return { ok: false, code: "PAYMENT_NOT_CONFIRMED", message: "The payment could not be completed." };
    }
    environment.contractRepository.recordConfirmedOutcome(outcome.reservation, outcome.bookingContract);

    const offerId = thread.offerId;
    const contractId = outcome.bookingContract.contractId;
    const paymentSurfaceId = `thread-${thread.threadId}:payment:confirmed:${offerId}`;
    const bookingSurfaceId = `thread-${thread.threadId}:booking:${contractId}`;
    this.#supersede(thread, PAYMENT_STAGE);
    thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);

    const paymentArtifact = environment.cardPaymentApp.getArtifact(offerId, environment.guestPrincipal());
    const contractArtifact = environment.contractApp.getArtifact(contractId, environment.guestPrincipal());

    return {
      ok: true,
      messages: ["Payment complete. Your booking is confirmed."],
      surfaces: [
        { surfaceId: paymentSurfaceId, a2uiMessages: cardPaymentArtifactToA2UI({ artifact: paymentArtifact, surfaceId: paymentSurfaceId }) },
        { surfaceId: bookingSurfaceId, a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) },
      ],
    };
  }

  #partySizeFor(thread: GuestThreadState): number {
    const filters = thread.discoveryArtifact?.facts.filters;
    return typeof filters?.partySize === "number" && Number.isInteger(filters.partySize) && filters.partySize >= 1
      ? filters.partySize
      : 1;
  }

  #stayDatesFor(thread: GuestThreadState): { readonly checkIn: string; readonly checkOut: string } {
    const filters = thread.discoveryArtifact?.facts.filters;
    if (typeof filters?.checkIn !== "string" || typeof filters.checkOut !== "string") {
      throw new Error("Discovery dates are required for the booking journey");
    }
    return { checkIn: filters.checkIn, checkOut: filters.checkOut };
  }
}

interface GuestEventPayload {
  readonly name: string;
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  readonly timestamp: string;
  readonly context: JsonObject | null;
}

function readEventPayload(payload: unknown): GuestEventPayload | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim() === "") return undefined;
  if (typeof record.surfaceId !== "string" || record.surfaceId.trim() === "") return undefined;
  const context: JsonObject | null =
    record.context !== null && typeof record.context === "object" && !Array.isArray(record.context)
      ? (record.context as JsonObject)
      : null;
  return {
    name: record.name,
    surfaceId: record.surfaceId,
    sourceComponentId: typeof record.sourceComponentId === "string" ? record.sourceComponentId : "unknown",
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
    context,
  };
}

export function renderGuestShellHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shortlet Concierge</title>
  <style>
    :root {
      --bg: #f7f7f5;
      --surface: #ffffff;
      --border: #e4e4e0;
      --text: #1c1c1a;
      --text-muted: #6b6b66;
      --accent: #0f6b4f;
      --accent-hover: #0c5840;
      --user-bubble: #0f6b4f;
    }
    * { box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      margin: 0;
      line-height: 1.5;
    }
    .app { max-width: 680px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; }
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--surface);
      position: sticky; top: 0; z-index: 10;
    }
    header h1 { font-size: 18px; margin: 0; font-weight: 650; }
    .demo-badge {
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--text-muted); border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px;
      background: var(--bg);
    }
    #transcript { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .turn { display: flex; flex-direction: column; gap: 4px; }
    .turn.user { align-items: flex-end; }
    .bubble {
      max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 15px; white-space: pre-wrap;
    }
    .turn.assistant .bubble { background: var(--surface); border: 1px solid var(--border); border-top-left-radius: 4px; }
    .turn.user .bubble { background: var(--user-bubble); color: #fff; border-top-right-radius: 4px; }
    .surface-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px; max-width: 92%; }
    .surface-card .weaver-mount { margin-top: 4px; }
    .surface-error { color: var(--text-muted); font-size: 14px; }
    form#composer {
      display: flex; gap: 10px; padding: 14px 20px 20px; border-top: 1px solid var(--border);
      background: var(--surface); position: sticky; bottom: 0;
    }
    #composer-input {
      flex: 1; padding: 11px 14px; border: 1px solid var(--border); border-radius: 10px;
      font-size: 15px; font-family: inherit; background: var(--bg); color: var(--text);
    }
    #composer-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
    #composer button {
      padding: 11px 20px; border: none; border-radius: 10px; background: var(--accent); color: #fff;
      font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit;
    }
    #composer button:hover { background: var(--accent-hover); }
    @media (max-width: 480px) { .app { max-width: 100%; } header { padding: 12px 14px; } #transcript { padding: 14px; } }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <h1>Shortlet Concierge</h1>
      <span class="demo-badge">Local demo</span>
    </header>
    <main id="transcript" aria-live="polite"></main>
    <form id="composer">
      <input id="composer-input" type="text" autocomplete="off"
             placeholder="Where would you like to stay?" aria-label="Message the concierge" />
      <button type="submit">Send</button>
    </form>
  </div>
  <script src="/client.js" defer></script>
</body>
</html>`;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw === "" ? {} : JSON.parse(raw));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export interface LocalGuestServerHandle {
  readonly port: number;
  readonly app: LocalGuestApp;
  /** The live environment; a fresh one is installed by /api/reset. */
  readonly environment: LocalGuestEnvironment;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function startLocalGuestServer(options: {
  port?: number;
  environment?: LocalGuestEnvironment;
  clientScriptPath?: string;
  geminiClient?: GeminiConciergeClient;
  conciergeMode?: "deterministic" | "gemini";
} = {}): LocalGuestServerHandle {
  const port = options.port ?? LOCAL_GUEST_PORT;
  const mode = options.conciergeMode ?? (process.env.CONCIERGE_MODE === "gemini" ? "gemini" : "deterministic");
  const geminiClient = options.geminiClient ?? (mode === "gemini"
    ? createGeminiConciergeClient(process.env.GEMINI_API_KEY ?? (() => { throw new Error("CONCIERGE_MODE=gemini requires GEMINI_API_KEY"); })(), process.env.GEMINI_MODEL ?? "gemini-2.5-flash")
    : undefined);
  const app = new LocalGuestApp(options.environment ?? new LocalGuestEnvironment(), { geminiClient });
  const clientScriptPath = options.clientScriptPath
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "client.js");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderGuestShellHtml());
      return;
    }

    if (req.method === "GET" && url.pathname === "/client.js") {
      try {
        const script = readFileSync(clientScriptPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        res.end(script);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Guest client bundle missing; run npm run guest:local to build it.");
      }
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/turn" || url.pathname === "/api/event" || url.pathname === "/api/reset")) {
      try {
        const body = await readJsonBody(req);
        if (url.pathname === "/api/reset") {
          app.reset();
          sendJson(res, 200, { ok: true });
          return;
        }
        const threadId = (body as { threadId?: unknown }).threadId;
        if (typeof threadId !== "string") {
          sendJson(res, 400, { ok: false, code: "INVALID_THREAD", message: "threadId is required." });
          return;
        }
        if (url.pathname === "/api/turn") {
          const text = (body as { text?: unknown }).text;
          if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
            sendJson(res, 400, { ok: false, code: "INVALID_INPUT", message: "A short message is required." });
            return;
          }
          sendJson(res, 200, await app.handleTurn(threadId, text));
          return;
        }
        sendJson(res, 200, app.handleEvent(threadId, body));
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unexpected server error.",
        });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return {
    port,
    app,
    get environment() {
      return app.environment;
    },
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolve(actualPort);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        app.environment.close();
        // Fetch clients may leave keep-alive sockets open after a response;
        // close them before waiting for the server callback so test and CLI
        // shutdowns are deterministic.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
