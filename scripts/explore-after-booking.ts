import {
  DEFAULT_AFTER_BOOKING_DEPTH,
  runAfterBookingChangeExploration,
} from "../test/helpers/booking-state-fixture.js";

function parseArgs(argv: readonly string[]): { depth: number; prune: boolean } {
  let depth = DEFAULT_AFTER_BOOKING_DEPTH;
  let prune = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--unpruned") {
      prune = false;
      continue;
    }
    if (arg === "--depth") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--depth requires an integer argument");
      }
      i += 1;
      depth = parseDepth(next);
      continue;
    }
    if (/^-?\d+$/.test(arg)) {
      depth = parseDepth(arg);
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}. Usage: npx tsx scripts/explore-after-booking.ts [depth] [--unpruned]`);
  }

  return { depth, prune };
}

function parseDepth(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`depth must be a non-negative integer, got: ${raw}`);
  }
  return value;
}

const { depth, prune } = parseArgs(process.argv.slice(2));
const result = runAfterBookingChangeExploration({
  depth,
  prune,
  storage: "memory",
});

console.log(
  JSON.stringify({
    depth,
    prune,
    explored: result.explored,
    pruned: result.pruned,
    violations: result.violations.length,
    shortestFailure: result.shortestFailure,
  }),
);
