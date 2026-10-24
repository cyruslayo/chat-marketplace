import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { GoogleGenAI } from "@google/genai";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { ModelRequestGuardError, type AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantTaskState } from "../apps/local-guest/src/assistant/assistant-state.js";
import { ASSISTANT_CONTROL_OUTCOMES, type AssistantControlOutcome, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { resolvePilotBaseUrl } from "./pilot-base-url.js";
import { authoritativePriceFacts, hasUnsupportedPriceOrConfirmation, SMOKE_GRADING_PROFILE } from "./pilot-agent-smoke-grading.js";
import { createSmokeReferenceModel } from "./pilot-agent-smoke-reference.js";
import {
  ProviderRequestBudget,
  parsePilotAgentSmokeRuns,
  parseProviderRequestLimit,
  providerStopReason as getProviderStopReason,
} from "./pilot-agent-smoke-budget.js";
import {
  TurnUsageAccumulator,
  buildPerformanceReport,
  createOpenRouterPriceFetcher,
  observeModelClient,
  type ModelPrice,
  type PerformanceReport,
  type TurnPerformance,
} from "./pilot-agent-smoke-metrics.js";
import {
  BENCHMARK_DOCUMENT_PATH,
  SMOKE_RESULT_FILE,
  buildSmokeResult,
  writeBenchmarkDocumentFromResult,
  writeSmokeArtifacts,
  type SmokeScenarioReport,
} from "./pilot-agent-smoke-report.js";

class ProviderRequestBudgetExceededError extends ModelRequestGuardError {
  constructor() {
    super("quota_denied");
    this.name = "ProviderRequestBudgetExceededError";
  }
}

const reportDirectory = resolve(process.env.PILOT_AGENT_SMOKE_REPORT_DIRECTORY?.trim() || ".scratch/pilot-agent-smoke");
// Offline: renders docs/testing/openrouter-gpt6-luna-benchmark.md from an existing live result file only.
// Refuses (exit 2) unless that file was produced by a live run. Never calls a provider.
if (process.argv.slice(2).includes("--write-benchmark-doc")) {
  try {
    await writeBenchmarkDocumentFromResult(resolve(reportDirectory, SMOKE_RESULT_FILE), resolve(BENCHMARK_DOCUMENT_PATH));
    console.log(`Benchmark document written to ${BENCHMARK_DOCUMENT_PATH}`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Benchmark document not written."}\n`);
    process.exit(2);
  }
}
// CONCIERGE_MODE=openai-compatible smokes the LLM_* provider (DeepSeek or OpenAI); anything else smokes Gemini.
const scripted = process.argv.slice(2).includes("--scripted");
const runArguments = process.argv.slice(2).filter((argument) => argument !== "--scripted");
const openAiCompatible = !scripted && process.env.CONCIERGE_MODE?.trim() === "openai-compatible";
const providerName = scripted ? "Scripted offline reference" : openAiCompatible ? process.env.LLM_PROVIDER_LABEL?.trim() || "openai-compatible" : "Google Gemini";
const model = scripted ? "scripted-reference" : openAiCompatible ? process.env.LLM_MODEL?.trim() ?? "" : process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
const credential = scripted ? undefined : openAiCompatible ? process.env.LLM_API_KEY : process.env.GEMINI_API_KEY;
// Slice 15: this smoke drives the assistant in-process and has no HTTP surface, so it cannot target a remote origin.
// Refuse before argument parsing or any model client is created; local runs are unchanged.
if (resolvePilotBaseUrl(runArguments, process.env) !== null) {
  process.stderr.write("pilot:local:agent-smoke runs in-process and cannot target a base URL. Run the staging journeys through pilot:acceptance:rodney with SHORTLET_BASE_URL.\n");
  process.exit(2);
}
const configuredJourneys = parsePilotAgentSmokeRuns(runArguments, process.env.PILOT_AGENT_SMOKE_RUNS);
const providerRequestLimit = parseProviderRequestLimit(runArguments, process.env.PILOT_AGENT_SMOKE_REQUEST_LIMIT);
const requestBudget = new ProviderRequestBudget(configuredJourneys, providerRequestLimit);
const providerReservationsPerTurn: ProviderTurnUsage[] = [];
const providerRequestsPerTurn: ProviderTurnUsage[] = [];
const controlOutcomes = new Map<AssistantControlOutcome, number>();
let totalProviderTransportStarts = 0;
let activeProviderTurn: ActiveProviderTurn | null = null;
const providerTurnContext = new AsyncLocalStorage<ActiveProviderTurn>();
let budgetExceeded = false;
let rateLimitOccurred = false;
let journeysAttempted = 0;
let providerStopClassification: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | null = null;

type ScenarioReport = SmokeScenarioReport;

// Per-turn wall-clock latency and provider-reported usage, grouped by journey (AC1).
const turnPerformanceByJourney = new Map<number, TurnPerformance[]>();
let activeTurnUsage: TurnUsageAccumulator | null = null;

interface ProviderTurnUsage {
  readonly journey: number;
  readonly turn: string;
  readonly providerRequests: number;
}

interface ActiveProviderTurn {
  readonly journey: number;
  readonly turn: string;
  providerReservations: number;
  transportStarts: number;
}

const scenarios = [
  "discovery",
  "refinement",
  "unit inspection",
  "booking intent",
];

async function writeReports(
  result: "NOT_RUN" | "PASS" | "FAIL",
  entries: readonly ScenarioReport[],
  note: string,
  journeysAttempted: number,
  performanceReport?: PerformanceReport,
): Promise<void> {
  const controlOutcomeCounts = Object.fromEntries(ASSISTANT_CONTROL_OUTCOMES.map((outcome) => [outcome, controlOutcomes.get(outcome) ?? 0])) as Record<AssistantControlOutcome, number>;
  await writeSmokeArtifacts(reportDirectory, buildSmokeResult({
    gradingProfile: SMOKE_GRADING_PROFILE,
    generatedAt: new Date().toISOString(),
    provider: providerName,
    model,
    result,
    // Live only when a credential was configured and at least one journey reached the provider.
    liveRun: Boolean(credential) && totalProviderTransportStarts > 0,
    credentialConfigured: Boolean(credential),
    configuredJourneyCount: configuredJourneys,
    journeysActuallyAttempted: journeysAttempted,
    totalReservedRequests: requestBudget.totalRequests,
    totalProviderRequests: totalProviderTransportStarts,
    controlOutcomeCounts,
    evaluationMetrics: {
      guardFailures: controlOutcomeCounts.guard_failure + controlOutcomeCounts.quota_refusal,
      falseRefusals: entries.filter((entry) => entry.falseRefusal === true).length,
      taskCompletions: entries.filter((entry) => entry.semanticResult === "PASS").length,
      prohibitedEffects: entries.reduce((sum, entry) => sum + (entry.prohibitedEffects ?? 0), 0),
    },
    providerReservationsPerTurn,
    providerRequestsPerTurn,
    providerRequestBudget: {
      perJourney: requestBudget.maxRequestsPerJourney,
      total: requestBudget.maxRequests,
    },
    providerRequestBudgetExceeded: budgetExceeded,
    rateLimitOccurred,
    providerStopClassification,
    scenarios: entries,
    note,
    ...(performanceReport ? { performance: performanceReport } : {}),
  }));
}

function recordTurnPerformance(journey: number, turn: TurnPerformance): void {
  const turns = turnPerformanceByJourney.get(journey) ?? [];
  turns.push(turn);
  turnPerformanceByJourney.set(journey, turns);
}

if (!credential && !scripted) {
  const entries: ScenarioReport[] = Array.from({ length: configuredJourneys }, (_, index) =>
    scenarios.map((scenario) => ({
      scenario: `run ${index + 1} ${scenario}`,
      selectedApplicationOperation: null,
      surfaceSelected: null,
      authoritativeEntities: [],
      semanticResult: "NOT_RUN" as const,
    }))).flat();
  await writeReports("NOT_RUN", entries, "Live-agent smoke not run — credentials unavailable", journeysAttempted);
  console.log("Live-agent smoke not run — credentials unavailable");
} else {
  const [fixtureModule, runtimeModule, modelModule, openAiModule, pilotModule, shortletModule] = await Promise.all([
    import("../apps/local-guest/src/fixture.js"),
    import("../apps/local-guest/src/assistant/assistant-runtime.js"),
    import("../apps/local-guest/src/assistant/gemini-interactions-client.js"),
    import("../apps/local-guest/src/assistant/openai-compatible-client.js"),
    import("../apps/pilot/src/local-pilot.js"),
    import("../domains/shortlet/src/index.js"),
  ]);
  const { LocalGuestEnvironment } = fixtureModule;
  const { AssistantRuntime } = runtimeModule;
  const { GeminiInteractionsClient } = modelModule;
  const { OpenAiCompatibleClient } = openAiModule;
  const { LOCAL_PILOT_ACTOR_ID, LOCAL_PILOT_OPERATOR_ID, LOCAL_PILOT_OPERATOR_NAME, LOCAL_PILOT_TENANT_ID, assertLocalPilotReady, localPilotClock, localPilotPaths } = pilotModule;
  const { createStayQuote } = shortletModule;
  const reports: ScenarioReport[] = [];
  const errors: string[] = [];
  const paths = localPilotPaths();
  let environment: LocalGuestEnvironment | undefined;
  let price: ModelPrice | null = null;
  let smokeDatabasePath: string | undefined;
  try {
    assertLocalPilotReady(paths);
    await mkdir(reportDirectory, { recursive: true });
    smokeDatabasePath = resolve(reportDirectory, `runtime-${process.pid}-${crypto.randomUUID()}.sqlite`);
    environment = LocalGuestEnvironment.openNode({
      databasePath: smokeDatabasePath,
      inventoryPath: paths.inventoryPath,
      tenantId: LOCAL_PILOT_TENANT_ID,
      operatorId: LOCAL_PILOT_OPERATOR_ID,
      operatorName: LOCAL_PILOT_OPERATOR_NAME,
      representativePersonId: LOCAL_PILOT_ACTOR_ID,
      representativePersonName: "Local Pilot Representative",
      adminId: "admin-local-pilot",
      guestId: "guest-local-bootstrap",
      guestName: "Local Guest",
      initialGuestPhoneNumber: null,
      initialGuestContactEmail: null,
      demoCheckIn: "2026-09-29",
      demoCheckOut: "2026-10-01",
      production: false,
      deterministicPsp: true,
      seedRepresentativeGrant: false,
      clock: localPilotClock(paths),
    });
    const reserveProviderRequest = (currentTurn: ActiveProviderTurn): void => {
      if (!requestBudget.reserve(currentTurn.journey)) {
        budgetExceeded = true;
        throw new ProviderRequestBudgetExceededError();
      }
      currentTurn.providerReservations++;
    };
    const noteTransportStart = (): void => {
      const currentTurn = providerTurnContext.getStore();
      if (!currentTurn) throw new Error("Provider transport started outside an active smoke turn");
      if (currentTurn.transportStarts >= currentTurn.providerReservations) throw new Error("Provider transport started without reserved capacity");
      currentTurn.transportStarts++;
      totalProviderTransportStarts++;
    };
    const providerClient = scripted ? createSmokeReferenceModel() : openAiCompatible
      ? new OpenAiCompatibleClient({
        apiKey: credential!,
        baseUrl: process.env.LLM_BASE_URL?.trim() ?? "",
        model,
        fetch: async (input, init) => {
          noteTransportStart();
          return fetch(input, init);
        },
      })
      : (() => {
        const googleAi = new GoogleGenAI({ apiKey: credential! });
        return new GeminiInteractionsClient({
          apiKey: credential!,
          model,
          customAi: {
            interactions: {
              create: async (params, options) => {
                noteTransportStart();
                return googleAi.interactions.create(
                  { ...params, stream: false },
                  { ...options, maxRetries: 0 },
                );
              },
            },
          },
        });
      })();
    // Counts every model call and its provider-reported usage per turn; the provider client itself is unchanged.
    const observedClient = observeModelClient(providerClient, {
      record: () => undefined,
      capture: () => activeTurnUsage,
    });
    const modelClient: AssistantModelClient = {
      ...(observedClient.supportsProviderAttemptReservation === true ? { supportsProviderAttemptReservation: true as const } : {}),
      generate(request) {
        if (scripted) return observedClient.generate(request);
        const currentTurn = activeProviderTurn;
        if (!currentTurn) throw new ProviderRequestBudgetExceededError();
        // Capture context before awaiting. Reservation failures never enter the injected transport catch.
        return providerTurnContext.run(currentTurn, () => observedClient.generate({ ...request,
          beforeProviderAttempt: async () => {
            reserveProviderRequest(currentTurn);
            await request.beforeProviderAttempt?.();
          },
        }));
      },
      projectProviderContinuation: (response, calls) => observedClient.projectProviderContinuation?.(response, calls),
    };
    // The OpenRouter catalogue is public and needs no credential. Gemini has no OpenRouter slug, so cost stays unavailable.
    const priceFetcher = createOpenRouterPriceFetcher({
      fetch: (url, init) => fetch(url, init),
    });
    price = openAiCompatible ? await priceFetcher(model) : null;
    journeyLoop: for (let run = 1; run <= configuredJourneys; run++) {
      journeysAttempted++;
      let turnDiagnostics: AssistantDiagnosticEvent[] = [];
      const runtime = new AssistantRuntime(environment, modelClient, {
        onDiagnostic: (event: AssistantDiagnosticEvent) => {
          turnDiagnostics.push(event);
        },
      });
      const threadId = `g-live-smoke-${run}`;
      const runEntries: ScenarioReport[] = [];
      const invokeTurn = async (turn: string, text: string) => {
        const usage: ActiveProviderTurn = { journey: run, turn, providerReservations: 0, transportStarts: 0 };
        const turnUsage = new TurnUsageAccumulator();
        activeProviderTurn = usage;
        activeTurnUsage = turnUsage;
        const startedAt = performance.now();
        try {
          return await runtime.handleTurn(threadId, text);
        } finally {
          const snapshot = turnUsage.snapshot();
          if (!scripted) recordTurnPerformance(run, {
            turn,
            latencyMs: Math.round(performance.now() - startedAt),
            modelCalls: snapshot.modelCalls,
            promptTokens: snapshot.promptTokens,
            completionTokens: snapshot.completionTokens,
            tokenUsage: snapshot.promptTokens === null || snapshot.completionTokens === null ? "unavailable" : "reported",
          });
          providerReservationsPerTurn.push({ journey: run, turn, providerRequests: usage.providerReservations });
          providerRequestsPerTurn.push({ journey: run, turn, providerRequests: usage.transportStarts });
          activeProviderTurn = null;
          activeTurnUsage = null;
        }
      };
      turnDiagnostics = [];
      const first = await invokeTurn("discovery", "Show me apartments in Wuse 2.");
      const discoveryDiagnostics = [...turnDiagnostics];
      const discoveryOperation = successfulOperation(discoveryDiagnostics);
      const thread = runtime.getThread(threadId);
      const discovered = thread.taskState.shortlist;
      const validUnits = discovered.every((stay) => {
        const unit = environment!.unitRepository.findById(stay.unitId);
        return unit !== null
          && unit.title === stay.title
          && unit.location.city === stay.city
          && unit.location.neighbourhood === stay.neighbourhood
          && unit.price.nightlyKobo === stay.nightlyKobo;
      });
      const discoveryPresentation = JSON.stringify(first.surfaces?.[0]?.a2uiMessages ?? []);
      const pricesAreAuthoritative = discovered.every((stay) => {
        const unit = environment!.unitRepository.findById(stay.unitId);
        if (!unit) return false;
        const displayedAmount = stay.allInStayTotalKobo ?? stay.nightlyKobo;
        return discoveryPresentation.includes(formatNairaKobo(displayedAmount));
      });
      const discoveryContextValid = thread.taskState.stayIntent.location === "Abuja"
        && thread.taskState.stayIntent.neighbourhood === "Wuse 2";
      const discoveryArtifactPresent = Boolean(thread.discoveryArtifactId
        && first.surfaces?.[0]?.surfaceId.endsWith(thread.discoveryArtifactId));
      const discoveryRender = await anyRenderable(first.surfaces ?? []);
      const discoveryFabricated = hasUnsupportedPriceOrConfirmation(first.messages ?? [], discovered.map(authoritativePriceFacts));
      const discoveryStopReason = providerStopReason(discoveryDiagnostics, budgetExceeded);
      if (discoveryStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} discovery`,
        falseRefusal: first.controlOutcome === "scope_redirect" || first.controlOutcome === "scope_unavailable",
        prohibitedEffects: unexpectedWorkflowEffects(thread.taskState),
        selectedApplicationOperation: discoveryOperation,
        surfaceSelected: first.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: discovered.map((stay) => stay.unitId),
        semanticResult: first.ok && discoveryOperation === "search_stays" && discoveryContextValid && discovered.length > 0 && validUnits && discoveryArtifactPresent && pricesAreAuthoritative && discoveryRender.ok && !discoveryFabricated ? "PASS" : "FAIL",
        ...(!(first.ok && discoveryOperation === "search_stays" && discoveryContextValid && discovered.length > 0 && validUnits && discoveryArtifactPresent && pricesAreAuthoritative && discoveryRender.ok && !discoveryFabricated) ? { failureClassification: classifyFailure(discoveryDiagnostics, discoveryRender.ok ? undefined : discoveryRender.failureClass, discoveryFabricated, discoveryStopReason) } : {}),
        note: `Wuse 2 filters=${discoveryContextValid}; authoritative units=${discovered.length}; entity=${validUnits}; InteractionArtifact=${discoveryArtifactPresent}; displayed prices=${pricesAreAuthoritative}; fabrication=${discoveryFabricated}; render=${discoveryRender.ok ? "PASS" : discoveryRender.failureClass}; diagnostics=${diagnosticSummary(discoveryDiagnostics)}`,
      });
      if (discoveryStopReason) {
        providerStopClassification = discoveryStopReason;
        errors.push(`run ${run} stopped: ${discoveryStopReason}`);
        reports.push(...runEntries, ...notRunScenarios(run, scenarios.slice(1), discoveryStopReason, providerReservationsPerTurn, providerRequestsPerTurn));
        break journeyLoop;
      }

      const priorIds = new Set(discovered.map((stay) => stay.unitId));
      turnDiagnostics = [];
      const refinement = await invokeTurn("refinement", "Only show me two-bedroom apartments.");
      const refinementDiagnostics = [...turnDiagnostics];
      const refinementOperation = successfulOperation(refinementDiagnostics);
      const refined = runtime.getThread(threadId);
      const refinedIds = refined.taskState.shortlist.map((stay) => stay.unitId);
      const refinementValid = refined.taskState.stayIntent.bedrooms === 2
        && refinedIds.every((id) => environment!.unitRepository.findById(id)?.bedrooms === 2)
        && refined.supersededSurfaces.has(first.surfaces?.[0]?.surfaceId ?? "")
        && refined.activeSurfaces.get("discovery") === refinement.surfaces?.[0]?.surfaceId;
      const refinementFabricated = hasUnsupportedPriceOrConfirmation(refinement.messages ?? [], refined.taskState.shortlist.map(authoritativePriceFacts));
      const refinementPresentation = JSON.stringify(refinement.surfaces?.[0]?.a2uiMessages ?? []);
      const refinedPricesAuthoritative = refined.taskState.shortlist.every((stay) => refinementPresentation.includes(formatNairaKobo(stay.allInStayTotalKobo ?? stay.nightlyKobo)));
      const refinementRender = await anyRenderable(refinement.surfaces ?? []);
      const refinementStopReason = providerStopReason(refinementDiagnostics, budgetExceeded);
      if (refinementStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} refinement`,
        falseRefusal: refinement.controlOutcome === "scope_redirect" || refinement.controlOutcome === "scope_unavailable",
        prohibitedEffects: unexpectedWorkflowEffects(refined.taskState),
        selectedApplicationOperation: refinementOperation,
        surfaceSelected: refinement.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: refinedIds,
        semanticResult: refinement.ok && refinementOperation === "search_stays" && refinementValid && refinedPricesAuthoritative && refinementRender.ok && !refinementFabricated ? "PASS" : "FAIL",
        ...(!(refinement.ok && refinementOperation === "search_stays" && refinementValid && refinedPricesAuthoritative && refinementRender.ok && !refinementFabricated) ? { failureClassification: classifyFailure(refinementDiagnostics, refinementRender.ok ? undefined : refinementRender.failureClass, refinementFabricated, refinementStopReason) } : {}),
        note: `Wuse 2 context preserved=${refined.taskState.stayIntent.location === "Abuja" && refined.taskState.stayIntent.neighbourhood === "Wuse 2"}; refined IDs and prices are authoritative; prior results=${priorIds.size}; zero-result projection valid=${refinedIds.length > 0 || (refinement.surfaces?.length === 1 && refinementRender.ok)}; fabrication=${refinementFabricated}; render=${refinementRender.ok ? "PASS" : refinementRender.failureClass}; diagnostics=${diagnosticSummary(refinementDiagnostics)}`,
      });
      if (refinementStopReason) {
        providerStopClassification = refinementStopReason;
        errors.push(`run ${run} stopped: ${refinementStopReason}`);
        reports.push(...runEntries, ...notRunScenarios(run, scenarios.slice(2), refinementStopReason, providerReservationsPerTurn, providerRequestsPerTurn));
        break journeyLoop;
      }

      turnDiagnostics = [];
      const inspection = await invokeTurn("unit inspection", "Open the first one.");
      const inspectionDiagnostics = [...turnDiagnostics];
      const inspectionOperation = successfulOperation(inspectionDiagnostics);
      const inspectionThread = runtime.getThread(threadId);
      const selected = inspectionThread.taskState.shortlist.find((stay) => stay.stayRef === inspectionThread.taskState.selectedStayRef);
      const detailRender = await anyRenderable(inspection.surfaces ?? []);
      const detailMessages = JSON.stringify(inspection.surfaces?.[0]?.a2uiMessages ?? []);
      const selectedUnit = selected ? environment.unitRepository.findById(selected.unitId) : null;
      const detailState = runtime.getThread(threadId).taskState.stayIntent;
      const detailCheckIn = detailState.checkIn ?? environment.config.demoCheckIn;
      const detailCheckOut = detailState.checkOut ?? environment.config.demoCheckOut;
      const detailQuote = selectedUnit && detailCheckOut
        ? createStayQuote({ unit: selectedUnit, checkIn: detailCheckIn, checkOut: detailCheckOut, partySize: detailState.partySize ?? 1, clock: environment.clock })
        : null;
      const detailFactsPreserved = Boolean(selected)
        && inspectionThread.taskState.selectedStayRef === selected!.stayRef
        && detailMessages.includes(selected!.title)
        && detailMessages.includes(selected!.neighbourhood)
        && detailMessages.includes(selected!.city)
        && Boolean(detailQuote && detailMessages.includes(formatNairaKobo(detailQuote.allInStayTotalKobo)));
      const detailFabricated = hasUnsupportedPriceOrConfirmation(inspection.messages ?? [], detailQuote ? [authoritativePriceFacts({
        nightlyKobo: selected!.nightlyKobo,
        allInStayTotalKobo: detailQuote.allInStayTotalKobo,
        accommodationKobo: detailQuote.lineItems.accommodationKobo,
        mandatoryFeesKobo: detailQuote.lineItems.mandatoryFeesKobo,
        refundableSecurityDepositKobo: detailQuote.refundableSecurityDepositKobo,
        amountDueNowKobo: detailQuote.totalAmountDueNowKobo,
      })] : []);
      const inspectionStopReason = providerStopReason(inspectionDiagnostics, budgetExceeded);
      if (inspectionStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} Unit inspection`,
        falseRefusal: inspection.controlOutcome === "scope_redirect" || inspection.controlOutcome === "scope_unavailable",
        prohibitedEffects: unexpectedWorkflowEffects(runtime.getThread(threadId).taskState),
        selectedApplicationOperation: inspectionOperation,
        surfaceSelected: inspection.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: selected ? [selected.unitId] : [],
        semanticResult: inspection.ok && inspectionOperation === "get_unit_details" && detailFactsPreserved && detailRender.ok && !detailFabricated ? "PASS" : "FAIL",
        ...(!(inspection.ok && inspectionOperation === "get_unit_details" && selected && detailFactsPreserved && detailRender.ok && !detailFabricated) ? { failureClassification: classifyFailure(inspectionDiagnostics, inspectionRenderFailure(inspection.surfaces?.length ?? 0, detailRender), detailFabricated, inspectionStopReason) } : {}),
        note: `selected from current shortlist=${Boolean(selected)}; authoritative detail facts=${detailFactsPreserved}; fabrication=${detailFabricated}; render=${detailRender.ok ? "PASS" : detailRender.failureClass}; diagnostics=${diagnosticSummary(inspectionDiagnostics)}`,
      });
      if (inspectionStopReason) {
        providerStopClassification = inspectionStopReason;
        errors.push(`run ${run} stopped: ${inspectionStopReason}`);
        reports.push(...runEntries, ...notRunScenarios(run, scenarios.slice(3), inspectionStopReason, providerReservationsPerTurn, providerRequestsPerTurn));
        break journeyLoop;
      }

      turnDiagnostics = [];
      const booking = await invokeTurn("booking intent", "I want to book this apartment for two nights for two guests.");
      const bookingDiagnostics = [...turnDiagnostics];
      const bookingOperation = successfulOperation(bookingDiagnostics);
      const bookingThread = runtime.getThread(threadId);
      const bookingState = bookingThread.taskState;
      let currentDraft: ReturnType<LocalGuestEnvironment["bookingRequestApp"]["getDraft"]> | undefined;
      try {
        if (bookingState.currentDraftId) currentDraft = environment!.bookingRequestApp.getDraft(bookingState.currentDraftId);
      } catch {
        currentDraft = undefined;
      }
      const hasDraft = Boolean(bookingState.currentDraftId && currentDraft?.status === "draft" && currentDraft.unitId === selected?.unitId);
      const bookingSurface = JSON.stringify(booking.surfaces?.[0]?.a2uiMessages ?? []);
      const guestActionRequired = bookingSurface.includes("shortlet.request-draft.review")
        && !bookingSurface.includes("shortlet.request-draft.submit");
      const availabilityRechecked = bookingDiagnostics.some((event) => event.effectCode === "request_draft_created_availability_checked_not_reserved")
        && hasDraft;
      const bookingCheckIn = refined.taskState.stayIntent.checkIn ?? environment.config.demoCheckIn;
      const bookingCheckOutDate = new Date(`${bookingCheckIn}T00:00:00Z`);
      bookingCheckOutDate.setUTCDate(bookingCheckOutDate.getUTCDate() + 2);
      const bookingCheckOut = bookingCheckOutDate.toISOString().slice(0, 10);
      const bookingQuote = selectedUnit
        ? createStayQuote({ unit: selectedUnit, checkIn: bookingCheckIn, checkOut: bookingCheckOut, partySize: 2, clock: environment.clock })
        : null;
      const bookingPriceAuthoritative = Boolean(bookingQuote && bookingSurface.includes(formatNairaKobo(bookingQuote.allInStayTotalKobo)));
      const noSubmission = !bookingState.currentBookingRequestId && !bookingState.pendingAction;
      const noDownstreamState = !bookingState.currentOfferId && !bookingState.currentReservationId && !bookingState.currentContractId
        && !bookingDiagnostics.some((event) => event.toolName === "propose_accept_offer" || event.toolName === "propose_start_payment");
      const draftRender = await anyRenderable(booking.surfaces ?? []);
      const bookingFabricated = hasUnsupportedPriceOrConfirmation(booking.messages ?? [], bookingQuote ? [authoritativePriceFacts({
        ...bookingQuote.lineItems, allInStayTotalKobo: bookingQuote.allInStayTotalKobo, amountDueNowKobo: bookingQuote.totalAmountDueNowKobo,
      })] : []);
      const bookingStopReason = providerStopReason(bookingDiagnostics, budgetExceeded);
      if (bookingStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} booking intent`,
        falseRefusal: booking.controlOutcome === "scope_redirect" || booking.controlOutcome === "scope_unavailable",
        prohibitedEffects: unexpectedWorkflowEffects(bookingState, true),
        selectedApplicationOperation: bookingOperation,
        surfaceSelected: booking.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: selected ? [selected.unitId] : [],
        semanticResult: booking.ok && bookingOperation === "prepare_request_draft" && hasDraft && availabilityRechecked && bookingPriceAuthoritative && guestActionRequired && noSubmission && noDownstreamState && draftRender.ok && !bookingFabricated ? "PASS" : "FAIL",
        ...(!(booking.ok && bookingOperation === "prepare_request_draft" && hasDraft && availabilityRechecked && bookingPriceAuthoritative && guestActionRequired && noSubmission && noDownstreamState && draftRender.ok && !bookingFabricated) ? { failureClassification: classifyFailure(bookingDiagnostics, inspectionRenderFailure(booking.surfaces?.length ?? 0, draftRender), bookingFabricated, bookingStopReason) } : {}),
        note: `Request Draft=${hasDraft}; availability rechecked=${availabilityRechecked}; application price intact=${bookingPriceAuthoritative}; Guest review action=${guestActionRequired}; no submission=${noSubmission}; no offer/reservation/contract/payment ops=${noDownstreamState}; false confirmation/pricing=${bookingFabricated}; render=${draftRender.ok ? "PASS" : draftRender.failureClass}; diagnostics=${diagnosticSummary(bookingDiagnostics)}.`,
      });
      if (bookingStopReason) {
        providerStopClassification = bookingStopReason;
        errors.push(`run ${run} stopped: ${bookingStopReason}`);
        reports.push(...runEntries);
        break journeyLoop;
      }
      reports.push(...runEntries);
      if (runEntries.some((entry) => entry.semanticResult === "FAIL")) errors.push(`run ${run} semantic assertion failed`);
    }
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : "UnknownError";
    errors.push(`environment error (${errorClass})`);
    for (const scenario of scenarios) reports.push({
      scenario,
      selectedApplicationOperation: null,
      surfaceSelected: null,
      authoritativeEntities: [],
      semanticResult: "FAIL",
      failureClassification: "APPLICATION_OPERATION_FAILURE",
      note: `Execution stopped (${errorClass}); exception text is omitted.`,
    });
  } finally {
    if (environment) {
      for (const event of environment.telemetry.events()) {
        if (event.type !== "assistant.control.outcome.v1" || typeof event.outcome !== "string"
          || !ASSISTANT_CONTROL_OUTCOMES.some((outcome) => outcome === event.outcome)) continue;
        const outcome = event.outcome as AssistantControlOutcome;
        controlOutcomes.set(outcome, (controlOutcomes.get(outcome) ?? 0) + 1);
      }
    }
    environment?.close();
    if (smokeDatabasePath) {
      await Promise.all([
        rm(smokeDatabasePath, { force: true }),
        rm(`${smokeDatabasePath}-wal`, { force: true }),
        rm(`${smokeDatabasePath}-shm`, { force: true }),
      ]);
    }
  }
  const failed = errors.length > 0;
  const performanceReport = buildPerformanceReport({
    journeys: [...turnPerformanceByJourney.entries()].map(([journey, turns]) => ({ journey, turns })),
    slug: model,
    price,
  });
  await writeReports(failed ? "FAIL" : "PASS", reports, failed ? errors.join("; ") : "All semantic assertions passed.", journeysAttempted, scripted ? undefined : performanceReport);
  if (failed) {
    console.error(`${scripted ? "Scripted reference" : "Live-agent smoke"} failed; see ${reportDirectory}/agent-smoke-report.md`);
    process.exitCode = 1;
  } else {
    console.log(`${scripted ? "Scripted reference" : "Live-agent smoke"} passed; see ${reportDirectory}/agent-smoke-report.md`);
  }
}

type RenderFailureClass = "PROJECTION_FAILURE" | "A2UI_FAILURE" | "WEAVER_FAILURE";

function unexpectedWorkflowEffects(state: AssistantTaskState, allowDraft = false): number {
  return [!allowDraft && state.currentDraftId, state.currentBookingRequestId, state.pendingAction,
    state.currentOfferId, state.currentReservationId, state.currentContractId].filter(Boolean).length;
}

async function anyRenderable(surfaces: readonly { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[]): Promise<{ readonly ok: true } | { readonly ok: false; readonly failureClass: RenderFailureClass }> {
  if (surfaces.length === 0) return { ok: false, failureClass: "PROJECTION_FAILURE" };
  for (const surface of surfaces) {
    const result = await renderable(surface.surfaceId, surface.a2uiMessages);
    if (result.ok) return result;
    if (result.failureClass === "A2UI_FAILURE") return result;
  }
  return { ok: false, failureClass: "WEAVER_FAILURE" };
}

async function renderable(surfaceId: string, messages: readonly unknown[]): Promise<{ readonly ok: true } | { readonly ok: false; readonly failureClass: RenderFailureClass }> {
  const [{ Window }, { createBasicWebRuntime }] = await Promise.all([import("happy-dom"), import("@cylayo/weaver-web")]);
  const window = new Window();
  try {
    const created = createBasicWebRuntime();
    if (!created.ok) return { ok: false, failureClass: "WEAVER_FAILURE" };
    for (const message of messages as readonly A2UIServerMessage[]) {
      if (!created.value.runtime.process(message).ok) return { ok: false, failureClass: "A2UI_FAILURE" };
    }
    const target = window.document.createElement("div") as unknown as Element;
    const mounted = created.value.mount({ surfaceId, target });
    return mounted.ok ? { ok: true } : { ok: false, failureClass: "WEAVER_FAILURE" };
  } catch {
    return { ok: false, failureClass: "A2UI_FAILURE" };
  } finally {
    window.close();
  }
}

function successfulOperation(diagnostics: readonly AssistantDiagnosticEvent[]): string | null {
  return diagnostics.find((event) => event.stage === "application_operation" && event.succeeded && event.toolName)?.toolName ?? null;
}

function providerStopReason(
  diagnostics: readonly AssistantDiagnosticEvent[],
  didExceedBudget: boolean,
): "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | undefined {
  const failedProviderRequest = diagnostics.find((event) => event.providerStatusCode !== undefined || event.errorClass !== undefined);
  return getProviderStopReason({
    providerStatusCode: failedProviderRequest?.providerStatusCode,
    providerErrorClass: failedProviderRequest?.errorClass,
    budgetExceeded: didExceedBudget,
  });
}

function notRunScenarios(
  journey: number,
  remainingScenarios: readonly string[],
  stopReason: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED",
  reservations: ProviderTurnUsage[],
  starts: ProviderTurnUsage[],
): ScenarioReport[] {
  return remainingScenarios.map((scenario) => {
    reservations.push({ journey, turn: scenario, providerRequests: 0 });
    starts.push({ journey, turn: scenario, providerRequests: 0 });
    return {
      scenario: `run ${journey} ${scenario}`,
      selectedApplicationOperation: null,
      surfaceSelected: null,
      authoritativeEntities: [],
      semanticResult: "NOT_RUN",
      failureClassification: stopReason,
      note: `Not attempted after ${stopReason}.`,
    };
  });
}

function inspectionRenderFailure(
  surfaceCount: number,
  render: { readonly ok: true } | { readonly ok: false; readonly failureClass: RenderFailureClass },
): RenderFailureClass | undefined {
  if (render.ok) return surfaceCount === 0 ? "PROJECTION_FAILURE" : undefined;
  return render.failureClass;
}

function classifyFailure(
  diagnostics: readonly AssistantDiagnosticEvent[],
  presentationFailure: RenderFailureClass | undefined,
  fabricated: boolean,
  providerStopReason?: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED",
): ScenarioReport["failureClassification"] {
  if (providerStopReason) return providerStopReason;
  if (fabricated) return "FABRICATION_FAILURE";
  const failure = diagnostics.find((event) => !event.succeeded);
  if (failure?.failureClass) return failure.failureClass;
  if (!successfulOperation(diagnostics)) return "MODEL_SELECTION_FAILURE";
  if (presentationFailure) return presentationFailure;
  return "MODEL_SELECTION_FAILURE";
}

function diagnosticSummary(diagnostics: readonly AssistantDiagnosticEvent[]): string {
  if (diagnostics.length === 0) return "none";
  return diagnostics.map((event) => `${event.stage}:${event.succeeded ? "ok" : event.failureClass ?? "failed"}${event.toolName ? `:${event.toolName}` : ""}${event.errorClass ? `:${event.errorClass}` : ""}${event.providerStatusCode ? `:http${event.providerStatusCode}` : ""}${event.providerErrorCode ? `:${event.providerErrorCode}` : ""}`).join(",");
}

function formatNairaKobo(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const absolute = Math.abs(kobo);
  const whole = String(Math.floor(absolute / 100));
  const firstGroupLength = whole.length % 3 || 3;
  const grouped = [whole.slice(0, firstGroupLength), ...whole.slice(firstGroupLength).match(/.{3}/g) ?? []].join(",");
  const remainder = absolute % 100;
  return `${sign}₦${grouped}${remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`}`;
}
