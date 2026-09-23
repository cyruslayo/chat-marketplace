import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { A2UIServerMessage } from "@weaver/core";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";

const reportDirectory = resolve(".scratch/pilot-agent-smoke");
const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
const credential = process.env.GEMINI_API_KEY;

interface ScenarioReport {
  readonly scenario: string;
  readonly selectedApplicationOperation: string | null;
  readonly surfaceSelected: string | null;
  readonly authoritativeEntities: readonly string[];
  readonly semanticResult: "PASS" | "FAIL" | "NOT_RUN";
  readonly failureClassification?: "PROVIDER_TRANSPORT_FAILURE" | "MODEL_SELECTION_FAILURE" | "INVALID_TOOL_FOR_STATE" | "APPLICATION_OPERATION_FAILURE" | "PROJECTION_FAILURE" | "A2UI_FAILURE" | "WEAVER_FAILURE" | "FABRICATION_FAILURE" | "AUTHORITY_FAILURE";
  readonly note?: string;
}

const scenarios = [
  "discovery",
  "refinement",
  "unit inspection",
  "booking intent",
];

async function writeReports(result: "NOT_RUN" | "PASS" | "FAIL", entries: readonly ScenarioReport[], note: string): Promise<void> {
  await mkdir(reportDirectory, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    provider: "Google Gemini",
    model,
    result,
    credentialConfigured: Boolean(credential),
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
  const entries: ScenarioReport[] = scenarios.map((scenario) => ({
    scenario,
    selectedApplicationOperation: null,
    surfaceSelected: null,
    authoritativeEntities: [],
    semanticResult: "NOT_RUN",
  }));
  await writeReports("NOT_RUN", entries, "Live-agent smoke not run — credentials unavailable");
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
    const modelClient = new GeminiInteractionsClient({ apiKey: credential, model });
    for (let run = 1; run <= 3; run++) {
      let turnDiagnostics: AssistantDiagnosticEvent[] = [];
      const runtime = new AssistantRuntime(environment, modelClient, {
        onDiagnostic: (event: AssistantDiagnosticEvent) => {
          turnDiagnostics.push(event);
        },
      });
      const threadId = `g-live-smoke-${run}`;
      const runEntries: ScenarioReport[] = [];
      turnDiagnostics = [];
      const first = await runtime.handleTurn(threadId, "Show me apartments in Wuse 2.");
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
      const discoveryRender = await anyRenderable(first.surfaces ?? []);
      const discoveryFabricated = hasUnsupportedPriceOrConfirmation(first.messages ?? [], discovered.map((stay) => [stay.nightlyKobo, stay.allInStayTotalKobo, stay.refundableSecurityDepositKobo]));
      runEntries.push({
        scenario: `run ${run} discovery`,
        selectedApplicationOperation: discoveryOperation,
        surfaceSelected: first.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: discovered.map((stay) => stay.unitId),
        semanticResult: first.ok && discoveryOperation === "search_stays" && discoveryContextValid && discovered.length > 0 && validUnits && pricesAreAuthoritative && discoveryRender.ok && !discoveryFabricated ? "PASS" : "FAIL",
        ...(!(first.ok && discoveryOperation === "search_stays" && discoveryContextValid && discovered.length > 0 && validUnits && pricesAreAuthoritative && discoveryRender.ok && !discoveryFabricated) ? { failureClassification: classifyFailure(discoveryDiagnostics, discoveryRender.ok ? undefined : discoveryRender.failureClass, discoveryFabricated) } : {}),
        note: `Wuse 2 filters=${discoveryContextValid}; authoritative units=${discovered.length}; entity=${validUnits}; displayed prices=${pricesAreAuthoritative}; fabrication=${discoveryFabricated}; render=${discoveryRender.ok ? "PASS" : discoveryRender.failureClass}; diagnostics=${diagnosticSummary(discoveryDiagnostics)}`,
      });

      const priorIds = new Set(discovered.map((stay) => stay.unitId));
      turnDiagnostics = [];
      const refinement = await runtime.handleTurn(threadId, "Only show me two-bedroom apartments.");
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
      runEntries.push({
        scenario: `run ${run} refinement`,
        selectedApplicationOperation: refinementOperation,
        surfaceSelected: refinement.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: refinedIds,
        semanticResult: refinement.ok && refinementOperation === "search_stays" && refinementValid && refinedPricesAuthoritative && !refinementFabricated ? "PASS" : "FAIL",
        ...(!(refinement.ok && refinementOperation === "search_stays" && refinementValid && refinedPricesAuthoritative && !refinementFabricated) ? { failureClassification: classifyFailure(refinementDiagnostics, refinement.surfaces?.length ? undefined : "PROJECTION_FAILURE", refinementFabricated) } : {}),
        note: `Wuse 2 context preserved=${refined.taskState.stayIntent.location === "Abuja" && refined.taskState.stayIntent.neighbourhood === "Wuse 2"}; refined IDs and prices are authoritative; prior results=${priorIds.size}; fabrication=${refinementFabricated}; diagnostics=${diagnosticSummary(refinementDiagnostics)}`,
      });

      turnDiagnostics = [];
      const inspection = await runtime.handleTurn(threadId, "Open the first one.");
      const inspectionDiagnostics = [...turnDiagnostics];
      const inspectionOperation = successfulOperation(inspectionDiagnostics);
      const selected = refined.taskState.shortlist[0];
      const detailRender = await anyRenderable(inspection.surfaces ?? []);
      const detailMessages = JSON.stringify(inspection.surfaces?.[0]?.a2uiMessages ?? []);
      const selectedUnit = selected ? environment.unitRepository.findById(selected.unitId) : null;
      const detailQuote = selectedUnit && environment.config.demoCheckOut
        ? createStayQuote({ unit: selectedUnit, checkIn: environment.config.demoCheckIn, checkOut: environment.config.demoCheckOut, partySize: 1, clock: environment.clock })
        : null;
      const detailFactsPreserved = Boolean(selected)
        && detailMessages.includes(selected!.title)
        && detailMessages.includes(selected!.neighbourhood)
        && detailMessages.includes(selected!.city)
        && Boolean(detailQuote && detailMessages.includes(formatNairaKobo(detailQuote.allInStayTotalKobo)));
      const detailFabricated = hasUnsupportedPriceOrConfirmation(inspection.messages ?? [], selected ? [[selected.nightlyKobo, selected.allInStayTotalKobo, selected.refundableSecurityDepositKobo]] : []);
      runEntries.push({
        scenario: `run ${run} Unit inspection`,
        selectedApplicationOperation: inspectionOperation,
        surfaceSelected: inspection.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: selected ? [selected.unitId] : [],
        semanticResult: inspection.ok && inspectionOperation === "get_unit_details" && detailFactsPreserved && detailRender.ok && !detailFabricated ? "PASS" : "FAIL",
        ...(!(inspection.ok && inspectionOperation === "get_unit_details" && selected && detailFactsPreserved && detailRender.ok && !detailFabricated) ? { failureClassification: classifyFailure(inspectionDiagnostics, inspectionRenderFailure(inspection.surfaces?.length ?? 0, detailRender), detailFabricated) } : {}),
        note: `selected from current shortlist=${Boolean(selected)}; authoritative detail facts=${detailFactsPreserved}; fabrication=${detailFabricated}; render=${detailRender.ok ? "PASS" : detailRender.failureClass}; diagnostics=${diagnosticSummary(inspectionDiagnostics)}`,
      });

      turnDiagnostics = [];
      const booking = await runtime.handleTurn(threadId, "I want to book this apartment for two nights for two guests.");
      const bookingDiagnostics = [...turnDiagnostics];
      const bookingOperation = successfulOperation(bookingDiagnostics);
      const bookingState = runtime.getThread(threadId).taskState;
      const hasDraft = Boolean(bookingState.currentDraftId);
      const bookingSurface = JSON.stringify(booking.surfaces?.[0]?.a2uiMessages ?? []);
      const guestActionRequired = bookingSurface.includes("shortlet.request-draft.review")
        && !bookingSurface.includes("shortlet.request-draft.submit");
      const noSubmission = !bookingState.currentBookingRequestId && !bookingState.pendingAction;
      const noDownstreamState = !bookingState.currentOfferId && !bookingState.currentReservationId && !bookingState.currentContractId
        && !bookingDiagnostics.some((event) => event.toolName === "propose_accept_offer" || event.toolName === "propose_start_payment");
      const draftRender = await anyRenderable(booking.surfaces ?? []);
      const bookingFabricated = hasUnsupportedPriceOrConfirmation(booking.messages ?? [], selected ? [[selected.nightlyKobo, selected.allInStayTotalKobo, selected.refundableSecurityDepositKobo]] : []);
      runEntries.push({
        scenario: `run ${run} booking intent`,
        selectedApplicationOperation: bookingOperation,
        surfaceSelected: booking.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: selected ? [selected.unitId] : [],
        semanticResult: booking.ok && bookingOperation === "prepare_request_draft" && hasDraft && guestActionRequired && noSubmission && noDownstreamState && draftRender.ok && !bookingFabricated ? "PASS" : "FAIL",
        ...(!(booking.ok && bookingOperation === "prepare_request_draft" && hasDraft && guestActionRequired && noSubmission && noDownstreamState && draftRender.ok && !bookingFabricated) ? { failureClassification: classifyFailure(bookingDiagnostics, inspectionRenderFailure(booking.surfaces?.length ?? 0, draftRender), bookingFabricated) } : {}),
        note: `Request Draft=${hasDraft}; availability rechecked=${hasDraft}; Guest review action=${guestActionRequired}; no submission=${noSubmission}; no offer/reservation/contract/payment ops=${noDownstreamState}; false confirmation/pricing=${bookingFabricated}; render=${draftRender.ok ? "PASS" : draftRender.failureClass}; diagnostics=${diagnosticSummary(bookingDiagnostics)}.`,
      });
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
  await writeReports(failed ? "FAIL" : "PASS", reports, failed ? errors.join("; ") : "All semantic assertions passed.");
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
): ScenarioReport["failureClassification"] {
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
