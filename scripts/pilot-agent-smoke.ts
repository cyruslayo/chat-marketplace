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
  readonly failureClassification?: "MODEL/ORCHESTRATION FAILURE" | "FABRICATION FAILURE" | "AUTHORITY FAILURE" | "PRESENTATION FAILURE" | "ENVIRONMENT FAILURE";
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
      const operations: string[] = [];
      const runtime = new AssistantRuntime(environment, modelClient, {
        onDiagnostic: (event: AssistantDiagnosticEvent) => {
          if (event.stage === "tool_execution" && event.toolName) operations.push(event.toolName);
        },
      });
      const threadId = `g-live-smoke-${run}`;
      const runEntries: ScenarioReport[] = [];
      const first = await runtime.handleTurn(threadId, "Show me apartments in Wuse 2.");
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
      const discoveryRendered = await anyRenderable(first.surfaces ?? []);
      const discoveryFabricated = hasUnsupportedPriceOrConfirmation(first.messages ?? [], discovered.map((stay) => [stay.nightlyKobo, stay.allInStayTotalKobo, stay.refundableSecurityDepositKobo]));
      runEntries.push({
        scenario: `run ${run} discovery`,
        selectedApplicationOperation: operations.at(-1) ?? null,
        surfaceSelected: first.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: discovered.map((stay) => stay.unitId),
        semanticResult: first.ok && operations.at(-1) === "search_stays" && discoveryContextValid && discovered.length > 0 && validUnits && pricesAreAuthoritative && discoveryRendered && !discoveryFabricated ? "PASS" : "FAIL",
        ...(!(first.ok && operations.at(-1) === "search_stays" && discoveryContextValid && discovered.length > 0 && validUnits && pricesAreAuthoritative && discoveryRendered && !discoveryFabricated) ? { failureClassification: discoveryFabricated ? "FABRICATION FAILURE" as const : first.ok ? "PRESENTATION FAILURE" as const : "ENVIRONMENT FAILURE" as const } : {}),
        note: `Wuse 2 filters=${discoveryContextValid}; authoritative units=${discovered.length}; entity=${validUnits}; displayed prices=${pricesAreAuthoritative}; fabrication=${discoveryFabricated}; Weaver=${discoveryRendered}`,
      });

      const priorIds = new Set(discovered.map((stay) => stay.unitId));
      const refinement = await runtime.handleTurn(threadId, "Only show me two-bedroom apartments.");
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
        selectedApplicationOperation: operations.at(-1) ?? null,
        surfaceSelected: refinement.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: refinedIds,
        semanticResult: refinement.ok && operations.at(-1) === "search_stays" && refinementValid && refinedPricesAuthoritative && !refinementFabricated ? "PASS" : "FAIL",
        ...(!(refinement.ok && operations.at(-1) === "search_stays" && refinementValid && refinedPricesAuthoritative && !refinementFabricated) ? { failureClassification: refinementFabricated ? "FABRICATION FAILURE" as const : refinement.ok ? "PRESENTATION FAILURE" as const : "ENVIRONMENT FAILURE" as const } : {}),
        note: `Wuse 2 context preserved=${refined.taskState.stayIntent.location === "Abuja" && refined.taskState.stayIntent.neighbourhood === "Wuse 2"}; refined IDs and prices are authoritative; prior results=${priorIds.size}; fabrication=${refinementFabricated}`,
      });

      const inspection = await runtime.handleTurn(threadId, "Open the first one.");
      const selected = refined.taskState.shortlist[0];
      const detailRendered = await anyRenderable(inspection.surfaces ?? []);
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
        selectedApplicationOperation: operations.at(-1) ?? null,
        surfaceSelected: inspection.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: selected ? [selected.unitId] : [],
        semanticResult: inspection.ok && operations.at(-1) === "get_unit_details" && detailFactsPreserved && detailRendered && !detailFabricated ? "PASS" : "FAIL",
        ...(!(inspection.ok && operations.at(-1) === "get_unit_details" && selected && detailFactsPreserved && detailRendered && !detailFabricated) ? { failureClassification: detailFabricated ? "FABRICATION FAILURE" as const : inspection.ok ? "PRESENTATION FAILURE" as const : "ENVIRONMENT FAILURE" as const } : {}),
        note: `selected from current shortlist=${Boolean(selected)}; authoritative detail facts=${detailFactsPreserved}; fabrication=${detailFabricated}; Weaver=${detailRendered}`,
      });

      const booking = await runtime.handleTurn(threadId, "I want to book this apartment for two nights for two guests.");
      const bookingOperation = operations.at(-1) ?? null;
      const bookingState = runtime.getThread(threadId).taskState;
      const hasDraft = Boolean(bookingState.currentDraftId);
      const bookingSurface = JSON.stringify(booking.surfaces?.[0]?.a2uiMessages ?? []);
      const guestActionRequired = bookingSurface.includes("shortlet.request-draft.review")
        && !bookingSurface.includes("shortlet.request-draft.submit");
      const noSubmission = !bookingState.currentBookingRequestId && !bookingState.pendingAction;
      const noDownstreamState = !bookingState.currentOfferId && !bookingState.currentReservationId && !bookingState.currentContractId
        && !operations.includes("propose_accept_offer") && !operations.includes("propose_start_payment");
      const draftRendered = await anyRenderable(booking.surfaces ?? []);
      const bookingFabricated = hasUnsupportedPriceOrConfirmation(booking.messages ?? [], selected ? [[selected.nightlyKobo, selected.allInStayTotalKobo, selected.refundableSecurityDepositKobo]] : []);
      runEntries.push({
        scenario: `run ${run} booking intent`,
        selectedApplicationOperation: bookingOperation,
        surfaceSelected: booking.surfaces?.[0]?.surfaceId ?? null,
        authoritativeEntities: selected ? [selected.unitId] : [],
        semanticResult: booking.ok && bookingOperation === "prepare_request_draft" && hasDraft && guestActionRequired && noSubmission && noDownstreamState && draftRendered && !bookingFabricated ? "PASS" : "FAIL",
        ...(!(booking.ok && bookingOperation === "prepare_request_draft" && hasDraft && guestActionRequired && noSubmission && noDownstreamState && draftRendered && !bookingFabricated) ? { failureClassification: bookingFabricated ? "FABRICATION FAILURE" as const : booking.ok ? "MODEL/ORCHESTRATION FAILURE" as const : "ENVIRONMENT FAILURE" as const } : {}),
        note: `Request Draft=${hasDraft}; availability rechecked=${hasDraft}; Guest review action=${guestActionRequired}; no submission=${noSubmission}; no offer/reservation/contract/payment ops=${noDownstreamState}; false confirmation/pricing=${bookingFabricated}; Weaver=${draftRendered}.`,
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
      failureClassification: "ENVIRONMENT FAILURE",
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

async function anyRenderable(surfaces: readonly { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[]): Promise<boolean> {
  for (const surface of surfaces) if (await renderable(surface.surfaceId, surface.a2uiMessages)) return true;
  return false;
}

async function renderable(surfaceId: string, messages: readonly unknown[]): Promise<boolean> {
  const [{ Window }, { createBasicWebRuntime }] = await Promise.all([import("happy-dom"), import("@weaver/web")]);
  const window = new Window();
  try {
    const created = createBasicWebRuntime();
    if (!created.ok) return false;
    for (const message of messages as readonly A2UIServerMessage[]) {
      if (!created.value.runtime.process(message).ok) return false;
    }
    const target = window.document.createElement("div") as unknown as Element;
    const mounted = created.value.mount({ surfaceId, target });
    return mounted.ok;
  } catch {
    return false;
  } finally {
    window.close();
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
