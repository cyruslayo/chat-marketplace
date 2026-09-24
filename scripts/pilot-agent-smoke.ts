import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { A2UIServerMessage } from "@weaver/core";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantConversationStep } from "../apps/local-guest/src/assistant/assistant-model.js";
import {
  DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY,
  ProviderRequestBudget,
  parsePilotAgentSmokeRuns,
  providerStopReason as getProviderStopReason,
} from "./pilot-agent-smoke-budget.js";

const reportDirectory = resolve(".scratch/pilot-agent-smoke");
const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
const credential = process.env.GEMINI_API_KEY;
const configuredJourneys = parsePilotAgentSmokeRuns(process.argv.slice(2), process.env.PILOT_AGENT_SMOKE_RUNS);
const requestBudget = new ProviderRequestBudget(configuredJourneys, DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY);
const providerRequestsPerTurn: ProviderTurnUsage[] = [];
let activeProviderTurn: ActiveProviderTurn | null = null;
let budgetExceeded = false;
let rateLimitOccurred = false;
let journeysAttempted = 0;
let providerStopClassification: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | null = null;

interface ScenarioReport {
  readonly scenario: string;
  readonly selectedApplicationOperation: string | null;
  readonly surfaceSelected: string | null;
  readonly authoritativeEntities: readonly string[];
  readonly semanticResult: "PASS" | "FAIL" | "NOT_RUN";
  readonly failureClassification?: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | "PROVIDER_TRANSPORT_FAILURE" | "MODEL_SELECTION_FAILURE" | "INVALID_TOOL_FOR_STATE" | "APPLICATION_OPERATION_FAILURE" | "PROJECTION_FAILURE" | "A2UI_FAILURE" | "WEAVER_FAILURE" | "FABRICATION_FAILURE" | "AUTHORITY_FAILURE";
  readonly note?: string;
}

interface ProviderTurnUsage {
  readonly journey: number;
  readonly turn: string;
  readonly providerRequests: number;
}

interface ActiveProviderTurn {
  readonly journey: number;
  readonly turn: string;
  providerRequests: number;
}

const scenarios = [
  "discovery",
  "refinement",
  "unit inspection",
  "booking intent",
];

async function writeReports(result: "NOT_RUN" | "PASS" | "FAIL", entries: readonly ScenarioReport[], note: string, journeysAttempted: number): Promise<void> {
  await mkdir(reportDirectory, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    provider: "Google Gemini",
    model,
    result,
    credentialConfigured: Boolean(credential),
    configuredJourneyCount: configuredJourneys,
    journeysActuallyAttempted: journeysAttempted,
    totalGeminiProviderRequests: requestBudget.totalRequests,
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
  };
  await writeFile(resolve(reportDirectory, "agent-smoke-result.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const lines = [
    "# Local pilot live-agent smoke",
    "",
    `- Provider: Google Gemini`,
    `- Model: ${model}`,
    `- Result: ${result}`,
    `- Credential configured: ${Boolean(credential)}`,
    `- Configured journeys: ${configuredJourneys}`,
    `- Journeys actually attempted: ${journeysAttempted}`,
    `- Total Gemini provider requests: ${requestBudget.totalRequests}`,
    `- Provider requests per turn: ${providerRequestsPerTurn.map((usage) => `journey ${usage.journey} ${usage.turn}=${usage.providerRequests}`).join(", ") || "none"}`,
    `- Provider request budget: ${requestBudget.maxRequests} total (${requestBudget.maxRequestsPerJourney} per journey)`,
    `- Provider request budget exceeded: ${budgetExceeded}`,
    `- HTTP 429 occurred: ${rateLimitOccurred}`,
    `- Provider stop classification: ${providerStopClassification ?? "none"}`,
    `- Note: ${note}`,
    "",
    "| Scenario | Operation | Surface | Authoritative entities | Result | Classification |",
    "|---|---|---|---|---|---|",
    ...entries.map((entry) => `| ${entry.scenario} | ${entry.selectedApplicationOperation ?? "—"} | ${entry.surfaceSelected ?? "—"} | ${entry.authoritativeEntities.join(", ") || "—"} | ${entry.semanticResult} | ${entry.failureClassification ?? "—"} |`),
    "",
    "No prompts, model prose, or credentials are recorded in this report.",
    "",
  ];
  await writeFile(resolve(reportDirectory, "agent-smoke-report.md"), lines.join("\n"), "utf8");
}

if (!credential) {
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
  const [fixtureModule, runtimeModule, modelModule, pilotModule, shortletModule] = await Promise.all([
    import("../apps/local-guest/src/fixture.js"),
    import("../apps/local-guest/src/assistant/assistant-runtime.js"),
    import("../apps/local-guest/src/assistant/gemini-interactions-client.js"),
    import("../apps/pilot/src/local-pilot.js"),
    import("../domains/shortlet/src/index.js"),
  ]);
  const { LocalGuestEnvironment } = fixtureModule;
  const { AssistantRuntime } = runtimeModule;
  const { GeminiInteractionsClient } = modelModule;
  const { LOCAL_PILOT_ACTOR_ID, LOCAL_PILOT_OPERATOR_ID, LOCAL_PILOT_OPERATOR_NAME, LOCAL_PILOT_TENANT_ID, assertLocalPilotReady, localPilotClock, localPilotPaths } = pilotModule;
  const { createStayQuote } = shortletModule;
  const reports: ScenarioReport[] = [];
  const errors: string[] = [];
  const paths = localPilotPaths();
  let environment: LocalGuestEnvironment | undefined;
  let smokeDatabasePath: string | undefined;
  try {
    assertLocalPilotReady(paths);
    await mkdir(reportDirectory, { recursive: true });
    smokeDatabasePath = resolve(reportDirectory, `runtime-${process.pid}.sqlite`);
    environment = new LocalGuestEnvironment({
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
    const googleAi = new GoogleGenAI({ apiKey: credential });
    const modelClient = new GeminiInteractionsClient({
      apiKey: credential,
      model,
      customAi: {
        interactions: {
          create: async (params, options) => {
            const currentTurn = activeProviderTurn;
            if (!currentTurn || !requestBudget.reserve(currentTurn.journey)) {
              budgetExceeded = true;
              throw new ProviderRequestBudgetExceededError();
            }
            currentTurn.providerRequests++;
            return googleAi.interactions.create(
              { ...params, stream: false },
              { ...options, maxRetries: 0 },
            );
          },
        },
      },
    });
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
        const usage: ActiveProviderTurn = { journey: run, turn, providerRequests: 0 };
        activeProviderTurn = usage;
        try {
          return await runtime.handleTurn(threadId, text);
        } finally {
          providerRequestsPerTurn.push({ journey: run, turn, providerRequests: usage.providerRequests });
          activeProviderTurn = null;
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
      const discoveryFabricated = hasUnsupportedPriceOrConfirmation(first.messages ?? [], discovered.map((stay) => [stay.nightlyKobo, stay.allInStayTotalKobo, stay.refundableSecurityDepositKobo]));
      const discoveryStopReason = providerStopReason(discoveryDiagnostics, budgetExceeded);
      if (discoveryStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} discovery`,
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
        reports.push(...runEntries, ...notRunScenarios(run, scenarios.slice(1), discoveryStopReason, providerRequestsPerTurn));
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
      const refinementFabricated = hasUnsupportedPriceOrConfirmation(refinement.messages ?? [], refined.taskState.shortlist.map((stay) => [stay.nightlyKobo, stay.allInStayTotalKobo, stay.refundableSecurityDepositKobo]));
      const refinementPresentation = JSON.stringify(refinement.surfaces?.[0]?.a2uiMessages ?? []);
      const refinedPricesAuthoritative = refined.taskState.shortlist.every((stay) => refinementPresentation.includes(formatNairaKobo(stay.allInStayTotalKobo ?? stay.nightlyKobo)));
      const refinementRender = await anyRenderable(refinement.surfaces ?? []);
      const refinementStopReason = providerStopReason(refinementDiagnostics, budgetExceeded);
      if (refinementStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} refinement`,
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
        reports.push(...runEntries, ...notRunScenarios(run, scenarios.slice(2), refinementStopReason, providerRequestsPerTurn));
        break journeyLoop;
      }

      turnDiagnostics = [];
      const inspectionHistoryStart = runtime.getThread(threadId).conversationHistory.length;
      const inspection = await invokeTurn("unit inspection", "Open the first one.");
      const inspectionDiagnostics = [...turnDiagnostics];
      const inspectionOperation = successfulOperation(inspectionDiagnostics);
      const selected = refined.taskState.shortlist[0];
      const inspectionToolResult = latestToolResult(runtime.getThread(threadId).conversationHistory, "get_unit_details", inspectionHistoryStart);
      const detailRender = await anyRenderable(inspection.surfaces ?? []);
      const detailMessages = JSON.stringify(inspection.surfaces?.[0]?.a2uiMessages ?? []);
      const selectedUnit = selected ? environment.unitRepository.findById(selected.unitId) : null;
      const detailQuote = selectedUnit && environment.config.demoCheckOut
        ? createStayQuote({ unit: selectedUnit, checkIn: environment.config.demoCheckIn, checkOut: environment.config.demoCheckOut, partySize: 1, clock: environment.clock })
        : null;
      const detailFactsPreserved = Boolean(selected)
        && inspectionToolResult?.stayRef === selected!.stayRef
        && detailMessages.includes(selected!.title)
        && detailMessages.includes(selected!.neighbourhood)
        && detailMessages.includes(selected!.city)
        && Boolean(detailQuote && detailMessages.includes(formatNairaKobo(detailQuote.allInStayTotalKobo)));
      const detailFabricated = hasUnsupportedPriceOrConfirmation(inspection.messages ?? [], selected ? [[selected.nightlyKobo, selected.allInStayTotalKobo, selected.refundableSecurityDepositKobo]] : []);
      const inspectionStopReason = providerStopReason(inspectionDiagnostics, budgetExceeded);
      if (inspectionStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} Unit inspection`,
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
        reports.push(...runEntries, ...notRunScenarios(run, scenarios.slice(3), inspectionStopReason, providerRequestsPerTurn));
        break journeyLoop;
      }

      turnDiagnostics = [];
      const bookingHistoryStart = runtime.getThread(threadId).conversationHistory.length;
      const booking = await invokeTurn("booking intent", "I want to book this apartment for two nights for two guests.");
      const bookingDiagnostics = [...turnDiagnostics];
      const bookingOperation = successfulOperation(bookingDiagnostics);
      const bookingThread = runtime.getThread(threadId);
      const bookingState = bookingThread.taskState;
      const hasDraft = Boolean(bookingState.currentDraftId);
      const bookingSurface = JSON.stringify(booking.surfaces?.[0]?.a2uiMessages ?? []);
      const guestActionRequired = bookingSurface.includes("shortlet.request-draft.review")
        && !bookingSurface.includes("shortlet.request-draft.submit");
      const bookingToolResult = latestToolResult(bookingThread.conversationHistory, "prepare_request_draft", bookingHistoryStart);
      const availabilityRechecked = bookingToolResult?.operation === "request_draft.create"
        && bookingToolResult.created === true
        && bookingToolResult.availabilityChecked === true
        && bookingToolResult.inventoryReserved === false;
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
      const bookingFabricated = hasUnsupportedPriceOrConfirmation(booking.messages ?? [], selected ? [[selected.nightlyKobo, selected.allInStayTotalKobo, selected.refundableSecurityDepositKobo]] : []);
      const bookingStopReason = providerStopReason(bookingDiagnostics, budgetExceeded);
      if (bookingStopReason === "PROVIDER_RATE_LIMITED") rateLimitOccurred = true;
      runEntries.push({
        scenario: `run ${run} booking intent`,
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
  await writeReports(failed ? "FAIL" : "PASS", reports, failed ? errors.join("; ") : "All semantic assertions passed.", journeysAttempted);
  if (failed) {
    console.error("Live-agent smoke failed; see .scratch/pilot-agent-smoke/agent-smoke-report.md");
    process.exitCode = 1;
  } else {
    console.log("Live-agent smoke passed; see .scratch/pilot-agent-smoke/agent-smoke-report.md");
  }
}

type RenderFailureClass = "PROJECTION_FAILURE" | "A2UI_FAILURE" | "WEAVER_FAILURE";

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
  const [{ Window }, { createBasicWebRuntime }] = await Promise.all([import("happy-dom"), import("@weaver/web")]);
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

function latestToolResult(history: readonly AssistantConversationStep[], name: string, startIndex: number): Record<string, unknown> | undefined {
  for (let index = history.length - 1; index >= startIndex; index--) {
    const step = history[index];
    if (step?.role !== "tool_results") continue;
    const result = step.results.find((candidate) => candidate.name === name)?.result;
    if (result) return result;
  }
  return undefined;
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
  usage: ProviderTurnUsage[],
): ScenarioReport[] {
  return remainingScenarios.map((scenario) => {
    usage.push({ journey, turn: scenario, providerRequests: 0 });
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

class ProviderRequestBudgetExceededError extends Error {
  constructor() {
    super("Live smoke provider request budget exhausted");
    this.name = "ProviderRequestBudgetExceededError";
  }
}

function hasUnsupportedPriceOrConfirmation(messages: readonly string[], priceGroups: readonly (readonly (number | null)[])[]): boolean {
  const text = messages.join(" ");
  if (/\b(?:booking|reservation) (?:is )?confirmed\b|\bpayment (?:is )?(?:successful|confirmed|complete)\b|\b(?:you are )?booked\b/i.test(text)) return true;
  const authoritativeKobo = new Set(priceGroups.flatMap((group) => group.filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount))));
  const claims = [...text.matchAll(/(?:₦|\bNGN\s*)([\d,]+(?:\.\d{1,2})?)/gi)];
  return claims.some((match) => {
    const naira = Number(match[1]?.replaceAll(",", ""));
    return !Number.isFinite(naira) || !authoritativeKobo.has(Math.round(naira * 100));
  });
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
