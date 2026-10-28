/**
 * Records the named assistant journeys as replayable regression evals (issue 03).
 *
 * Usage:
 *   node --import tsx scripts/record-assistant-journey.ts [journey ...] [--out <dir>] [--database <path>]
 *
 * Offline (default): every journey is recorded through the scripted model and written to `test/fixtures/assistant-recordings/`
 * unless `--out` names another directory. Only the committed fixtures are rewritten by this mode.
 *
 * Live (ASSISTANT_RECORD_LIVE=1): one real provider answers the journeys. The production OpenAI-compatible client is built
 * from the same environment the pilot reads (CONCIERGE_MODE is forced to openai-compatible). Live mode is opt-in and has
 * three extra rules:
 * - `--out` is required and must sit outside `test/fixtures`, so a live run never overwrites a committed recording.
 * - A call budget bounds the run: `LIVE_RECORDING_CALL_BUDGET` model calls in total (every classifier, planner and retry call
 *   counts). The run stops with an error when the budget is spent. The default is an engineering setting for four short
 *   journeys, not a provider limit.
 * - Before any file is written, the recording is scanned for credential-like text (bearer tokens, authorization headers,
 *   key names, JWT-shaped strings and the configured key values). A match refuses the write and names only the pattern.
 * The script never prints the environment or any key.
 *
 * Every mode refuses a journey whose recording breaks an intended outcome (see `intendedOutcomeViolations`): a typed cancel
 * must settle with the cancel copy and no pending surface, and a stale button press must be refused.
 *
 * The database is the in-memory local fixture (`:memory:`) by default. Any other `--database` value is refused unless it
 * is the local guest fixture file (ADR 0075: recordings hold local test data only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { DEFAULT_LOCAL_GUEST_CONFIG } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { createConciergeModelClient, loadConciergeConfiguration } from "../apps/local-guest/src/assistant/concierge-configuration.js";
import {
  ASSISTANT_RECORDING_FORMAT,
  RecordingModelClient,
  assertLocalFixtureDatabase,
} from "../apps/local-guest/src/assistant/assistant-recording.js";
import {
  RECORDED_JOURNEYS,
  RECORDINGS_DIRECTORY,
  definitionOf,
  intendedOutcomeViolations,
  journeyScriptedModel,
  openJourneyEnvironment,
  runJourney,
  type AssistantJourneyRecording,
} from "../test/helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK } from "../test/helpers/guest-date-fixtures.js";

/** Engineering setting: model calls allowed in one live recording run (all four journeys together). */
export const LIVE_RECORDING_CALL_BUDGET = 60;

const FIXTURES_DIRECTORY = resolve(RECORDINGS_DIRECTORY, "..");

/** Credential-like shapes. A match names the pattern only, never the text that matched. */
const CREDENTIAL_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "bearer token", pattern: /bearer\s+[A-Za-z0-9._~+/=-]{8,}/i },
  { name: "authorization header", pattern: /authorization/i },
  { name: "api key name", pattern: /api[_-]?key/i },
  { name: "provider key prefix", pattern: /\bsk-[A-Za-z0-9_-]{10,}/ },
  { name: "secret environment name", pattern: /LLM_API_KEY|GEMINI_API_KEY|PAYSTACK_SECRET|OPS_SHARED_SECRET/ },
  { name: "JWT-shaped string", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
];

interface Options {
  readonly journeys: readonly string[];
  readonly outDirectory: string | undefined;
  readonly databasePath: string;
  readonly live: boolean;
}

function parseArguments(argv: readonly string[]): Options {
  let outDirectory: string | undefined;
  let databasePath = ":memory:";
  const journeys: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (argument === "--out") outDirectory = argv[++index] ?? "";
    else if (argument === "--database") databasePath = argv[++index] ?? "";
    else journeys.push(argument);
  }
  const names = journeys.length > 0 ? journeys : RECORDED_JOURNEYS.map((journey) => journey.name);
  for (const name of names) definitionOf(name);
  const live = process.env.ASSISTANT_RECORD_LIVE === "1";
  if (live) {
    if (!outDirectory) throw new Error("Live recording needs an explicit --out directory outside test/fixtures.");
    const target = resolve(outDirectory);
    const relativeToFixtures = relative(FIXTURES_DIRECTORY, target);
    if (relativeToFixtures === "" || (!relativeToFixtures.startsWith("..") && !isAbsolute(relativeToFixtures))) {
      throw new Error("Live recording refused: --out must sit outside test/fixtures so committed recordings are never overwritten.");
    }
  }
  return { journeys: names, outDirectory, databasePath, live };
}

/** Counts every model call and stops the run when the live budget is spent. The budget is shared by all journeys. */
class BudgetedLiveClient implements AssistantModelClient {
  readonly supportsProviderAttemptReservation: true | undefined;
  readonly #inner: AssistantModelClient;
  readonly #budget: { remaining: number };

  constructor(inner: AssistantModelClient, budget: { remaining: number }) {
    this.#inner = inner;
    this.#budget = budget;
    if (inner.supportsProviderAttemptReservation === true) this.supportsProviderAttemptReservation = true;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    if (this.#budget.remaining <= 0) throw new Error(`Live recording stopped: the call budget of ${LIVE_RECORDING_CALL_BUDGET} model calls is spent.`);
    this.#budget.remaining--;
    return this.#inner.generate(request);
  }
}

/** The provider when ASSISTANT_RECORD_LIVE=1, otherwise the offline scripted model for the journey. */
function modelFor(journey: string, budget: { remaining: number }): { readonly model: AssistantModelClient; readonly source: string; readonly secrets: readonly string[] } {
  if (process.env.ASSISTANT_RECORD_LIVE !== "1") {
    return { model: journeyScriptedModel(definitionOf(journey)), source: "scripted", secrets: [] };
  }
  const configuration = loadConciergeConfiguration({ ...process.env, CONCIERGE_MODE: "openai-compatible" });
  const live = createConciergeModelClient(configuration);
  if (!live) throw new Error("ASSISTANT_RECORD_LIVE=1 requires a configured provider");
  // The configured key values are scanned for, so a key that somehow reaches a recording is refused.
  const secrets = [configuration.primary?.apiKey, configuration.fallback?.apiKey].filter((key): key is string => typeof key === "string" && key.length >= 8);
  return { model: new BudgetedLiveClient(live, budget), source: "openai-compatible", secrets };
}

/** Returns the names of the credential-like patterns found in the serialised recording. Never returns the matched text. */
export function credentialFindings(serialised: string, secrets: readonly string[] = []): string[] {
  const found = CREDENTIAL_PATTERNS.filter(({ pattern }) => pattern.test(serialised)).map(({ name }) => name);
  if (secrets.some((secret) => serialised.includes(secret))) found.push("configured provider key value");
  return found;
}

async function recordJourney(journey: string, options: Options, budget: { remaining: number }): Promise<void> {
  const definition = definitionOf(journey);
  // Refuse before any database is opened: only the local fixture database may hold a recording.
  assertLocalFixtureDatabase(options.databasePath, DEFAULT_LOCAL_GUEST_CONFIG.databasePath);
  const { model, source, secrets } = modelFor(journey, budget);
  const recorder = new RecordingModelClient(model);
  const environment = openJourneyEnvironment(options.databasePath);
  try {
    const turns = await runJourney(definition, environment, recorder);
    const violations = intendedOutcomeViolations(definition, turns);
    if (violations.length > 0) throw new Error(`Recording refused for ${journey}: ${violations.join("; ")}`);
    const recording: AssistantJourneyRecording = {
      format: ASSISTANT_RECORDING_FORMAT,
      journey,
      description: definition.description,
      clock: LIVE_LIKE_CLOCK().toISOString(),
      source,
      exchanges: recorder.exchanges,
      turns,
    };
    const serialised = `${JSON.stringify(recording, null, 2)}\n`;
    const findings = credentialFindings(serialised, secrets);
    if (findings.length > 0) throw new Error(`Recording refused for ${journey}: credential-like content found (${findings.join(", ")})`);
    const directory = options.outDirectory ?? RECORDINGS_DIRECTORY;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${journey}.json`), serialised, "utf8");
    console.log(`recorded ${journey}: ${recorder.exchanges.length} model exchange(s), ${turns.length} turn(s), source ${source}`);
  } finally {
    environment.close();
  }
}

// Runs only as the script, so the unit tests can import `credentialFindings` and the option parser without recording.
if (process.argv[1]?.endsWith("record-assistant-journey.ts")) {
  const options = parseArguments(process.argv.slice(2));
  const budget = { remaining: LIVE_RECORDING_CALL_BUDGET };
  for (const journey of options.journeys) {
    await recordJourney(journey, options, budget);
  }
}
