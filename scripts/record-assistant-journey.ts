/**
 * Records the named assistant journeys as replayable regression evals (issue 03).
 *
 * Usage:
 *   node --import tsx scripts/record-assistant-journey.ts [journey ...] [--out <dir>] [--database <path>]
 *
 * By default every journey is recorded through the offline scripted model and written to
 * `test/fixtures/assistant-recordings/`. A real provider is used only when ASSISTANT_RECORD_LIVE=1 is set; then the
 * production OpenAI-compatible client is built from the same environment the pilot reads (CONCIERGE_MODE is forced to
 * openai-compatible). The script never prints the environment or any key.
 *
 * The database is the in-memory local fixture (`:memory:`) by default. Any other `--database` value is refused unless it
 * is the local guest fixture file (ADR 0075: recordings hold local test data only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCAL_GUEST_CONFIG } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
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
  journeyScriptedModel,
  openJourneyEnvironment,
  runJourney,
  type AssistantJourneyRecording,
} from "../test/helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK } from "../test/helpers/guest-date-fixtures.js";

interface Options {
  readonly journeys: readonly string[];
  readonly outDirectory: string;
  readonly databasePath: string;
}

function parseArguments(argv: readonly string[]): Options {
  let outDirectory = RECORDINGS_DIRECTORY;
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
  return { journeys: names, outDirectory, databasePath };
}

/** The provider when ASSISTANT_RECORD_LIVE=1, otherwise the offline scripted model for the journey. */
function modelFor(journey: string): { readonly model: AssistantModelClient; readonly source: string } {
  if (process.env.ASSISTANT_RECORD_LIVE !== "1") {
    return { model: journeyScriptedModel(definitionOf(journey)), source: "scripted" };
  }
  const configuration = loadConciergeConfiguration({ ...process.env, CONCIERGE_MODE: "openai-compatible" });
  const live = createConciergeModelClient(configuration);
  if (!live) throw new Error("ASSISTANT_RECORD_LIVE=1 requires a configured provider");
  return { model: live, source: "openai-compatible" };
}

async function recordJourney(journey: string, options: Options): Promise<void> {
  const definition = definitionOf(journey);
  // Refuse before any database is opened: only the local fixture database may hold a recording.
  assertLocalFixtureDatabase(options.databasePath, DEFAULT_LOCAL_GUEST_CONFIG.databasePath);
  const { model, source } = modelFor(journey);
  const recorder = new RecordingModelClient(model);
  const environment = openJourneyEnvironment(options.databasePath);
  try {
    const turns = await runJourney(definition, environment, recorder);
    const recording: AssistantJourneyRecording = {
      format: ASSISTANT_RECORDING_FORMAT,
      journey,
      description: definition.description,
      clock: LIVE_LIKE_CLOCK().toISOString(),
      source,
      exchanges: recorder.exchanges,
      turns,
    };
    mkdirSync(options.outDirectory, { recursive: true });
    writeFileSync(join(options.outDirectory, `${journey}.json`), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
    console.log(`recorded ${journey}: ${recorder.exchanges.length} model exchange(s), ${turns.length} turn(s), source ${source}`);
  } finally {
    environment.close();
  }
}

const options = parseArguments(process.argv.slice(2));
for (const journey of options.journeys) {
  await recordJourney(journey, options);
}
