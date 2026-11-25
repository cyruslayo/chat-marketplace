export type DigestValue = string | number | boolean | null;
export type DigestRecord = Readonly<Record<string, DigestValue>>;

export interface StateDigest<W> {
  readonly fields: readonly string[];
  readonly read: (world: W) => DigestRecord;
}

export interface OrderStep<W> {
  readonly name: string;
  readonly run: (world: W) => void;
  readonly required?: boolean;
}

export interface OrderViolation<D = unknown> {
  readonly sequence: readonly string[];
  readonly reason: string;
  readonly detail?: D;
}

export interface OrderCheck<W, D = unknown> {
  readonly reads: readonly string[];
  readonly verify: (world: W) => { readonly reason: string; readonly detail?: D } | null;
}

export interface ExploreOrdersOptions<W, D = unknown> {
  readonly steps: readonly OrderStep<W>[];
  readonly depth: number;
  readonly newWorld: () => W;
  readonly disposeWorld?: (world: W) => void;
  readonly digest?: StateDigest<W>;
  readonly prune?: boolean;
  readonly check: OrderCheck<W, D>;
}

export interface ExploreOrdersResult<D = unknown> {
  readonly explored: number;
  readonly pruned: number;
  readonly violations: readonly OrderViolation<D>[];
  readonly shortestFailure: OrderViolation<D> | null;
  readonly stepSuccessCounts: Readonly<Record<string, number>>;
}

export interface FaultController {
  readonly failingPorts: readonly string[];
  readonly remaining: Readonly<Record<string, number>>;
  readonly calls: readonly string[];
  failIfArmed(port: string): void;
}

export interface FailureViolation<D = unknown> {
  readonly sequence: readonly string[];
  readonly failingPorts: readonly string[];
  readonly calls: readonly string[];
  readonly reason: string;
  readonly detail?: D;
}

export interface ExploreFailuresOptions<W, D = unknown> {
  readonly ports: readonly string[];
  readonly resumes: number;
  readonly newWorld: (faults: FaultController) => W;
  readonly disposeWorld?: (world: W) => void;
  readonly run: (world: W) => void;
  readonly resume?: (world: W) => void;
  readonly check: (world: W, faults: FaultController) => { readonly reason: string; readonly detail?: D } | null;
}

export interface ExploreFailuresResult<D = unknown> {
  readonly explored: number;
  readonly violations: readonly FailureViolation<D>[];
  readonly shortestFailure: FailureViolation<D> | null;
  readonly stepSuccessCounts: Readonly<Record<string, number>>;
  readonly portSuccessCounts: Readonly<Record<string, number>>;
}

function validateUniqueNames(names: readonly string[], label: string): void {
  if (names.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${label} entries must be non-empty strings`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate ${label} entry: ${name}`);
    }
    seen.add(name);
  }
}

function isDigestValue(value: unknown): value is DigestValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function validateDigestDeclaration<W, D>(
  digest: StateDigest<W>,
  check: OrderCheck<W, D>,
): void {
  validateUniqueNames(digest.fields, "digest field");
  validateUniqueNames(check.reads, "check.reads");
  const declared = new Set(digest.fields);
  const missing = check.reads.filter((field) => !declared.has(field));
  if (missing.length > 0) {
    throw new Error(`Digest omits field(s) read by check: ${missing.join(", ")}`);
  }
}

function readDigestKey<W>(digest: StateDigest<W>, world: W): string {
  const record = digest.read(world);
  const ordered: [string, DigestValue][] = [];
  for (const field of digest.fields) {
    if (!Object.hasOwn(record, field) || record[field] === undefined) {
      throw new Error(`Digest runtime output omitted declared field: ${field}`);
    }
    const value = record[field];
    if (!isDigestValue(value)) {
      throw new Error(`Digest field "${field}" must be string, number, boolean, or null`);
    }
    ordered.push([field, value]);
  }
  return JSON.stringify(ordered);
}

function withFreshWorld<W, T>(
  newWorld: () => W,
  disposeWorld: ((world: W) => void) | undefined,
  fn: (world: W) => T,
): T {
  const world = newWorld();
  try {
    return fn(world);
  } finally {
    disposeWorld?.(world);
  }
}

/**
 * Explores step sequences up to `depth` in breadth-first order over a fresh world per sequence,
 * reporting the shortest failing sequence first and pruning duplicate or unchanged-refusal prefixes
 * when a state digest is supplied. Pruning is sound only if the digest records every piece of
 * state that changes what a later step does, not only the fields the check reads.
 */
export function exploreOrders<W, D = unknown>(
  options: ExploreOrdersOptions<W, D>,
): ExploreOrdersResult<D> {
  if (!Number.isInteger(options.depth) || options.depth < 0) {
    throw new Error(`depth must be a non-negative integer, got ${options.depth}`);
  }
  validateUniqueNames(
    options.steps.map((step) => step.name),
    "step",
  );

  const shouldPrune = options.prune ?? options.digest !== undefined;
  if (shouldPrune && options.digest === undefined) {
    throw new Error("Pruning requires a state digest");
  }
  if (options.digest !== undefined) {
    validateDigestDeclaration(options.digest, options.check);
  }

  const stepByName = new Map<string, OrderStep<W>>();
  const stepSuccessCounts: Record<string, number> = {};
  for (const step of options.steps) {
    stepByName.set(step.name, step);
    stepSuccessCounts[step.name] = 0;
  }

  const seen = new Map<string, number>();
  if (shouldPrune && options.digest !== undefined) {
    const digest = options.digest;
    const initialKey = withFreshWorld(options.newWorld, options.disposeWorld, (world) =>
      readDigestKey(digest, world),
    );
    seen.set(initialKey, 0);
  }

  let explored = 0;
  let pruned = 0;
  const violations: OrderViolation<D>[] = [];
  let frontier: readonly (readonly string[])[] = [[]];

  for (let level = 1; level <= options.depth; level++) {
    const nextFrontier: string[][] = [];

    for (const prefix of frontier) {
      for (const step of options.steps) {
        const sequence = [...prefix, step.name];
        explored += 1;

        withFreshWorld(options.newWorld, options.disposeWorld, (world) => {
          for (const prefixStepName of prefix) {
            try {
              stepByName.get(prefixStepName)!.run(world);
            } catch {
              // Prefix replay ignores refused steps just like the live sequence execution.
            }
          }

          const beforeKey =
            shouldPrune && options.digest !== undefined
              ? readDigestKey(options.digest, world)
              : undefined;

          let lastSucceeded = false;
          try {
            step.run(world);
            lastSucceeded = true;
            stepSuccessCounts[step.name] += 1;
          } catch {
            lastSucceeded = false;
          }

          const failure = options.check.verify(world);
          if (failure !== null) {
            violations.push({
              sequence,
              reason: failure.reason,
              ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
            });
          }

          if (level >= options.depth) {
            return;
          }

          if (!shouldPrune || options.digest === undefined) {
            nextFrontier.push(sequence);
            return;
          }

          const afterKey = readDigestKey(options.digest, world);
          if (!lastSucceeded && afterKey === beforeKey) {
            pruned += 1;
            return;
          }
          if (seen.has(afterKey)) {
            pruned += 1;
            return;
          }
          seen.set(afterKey, level);
          nextFrontier.push(sequence);
        });
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) {
      break;
    }
  }

  const unreachedRequired = options.steps
    .filter((step) => step.required === true && stepSuccessCounts[step.name] === 0)
    .map((step) => step.name);
  if (unreachedRequired.length > 0) {
    throw new Error(
      `Required step(s) never succeeded in any explored order: ${unreachedRequired.join(", ")}`,
    );
  }

  return {
    explored,
    pruned,
    violations,
    shortestFailure: violations[0] ?? null,
    stepSuccessCounts,
  };
}

function combinationsBySize(ports: readonly string[]): readonly (readonly string[])[] {
  const result: string[][] = [];
  const total = 1 << ports.length;
  const byMask: string[][] = [];
  for (let mask = 0; mask < total; mask++) {
    const combo: string[] = [];
    for (let i = 0; i < ports.length; i++) {
      if ((mask & (1 << i)) !== 0) {
        combo.push(ports[i]!);
      }
    }
    byMask.push(combo);
  }
  byMask.sort((a, b) => a.length - b.length);
  for (const combo of byMask) {
    result.push(combo);
  }
  return result;
}

/**
 * Explores every combination of single-shot port failures (ordered from fewest to most failing ports),
 * running `run` once and `resume` (or `run`) `resumes` times over a fresh world per combination.
 */
export function exploreFailures<W, D = unknown>(
  options: ExploreFailuresOptions<W, D>,
): ExploreFailuresResult<D> {
  if (!Number.isInteger(options.resumes) || options.resumes < 0) {
    throw new Error(`resumes must be a non-negative integer, got ${options.resumes}`);
  }
  validateUniqueNames(options.ports, "port");

  const declaredPorts = new Set(options.ports);
  const combos = combinationsBySize(options.ports);
  const violations: FailureViolation<D>[] = [];
  const stepSuccessCounts: Record<string, number> = {
    initial: 0,
    resume: 0,
  };
  const portSuccessCounts: Record<string, number> = {};
  for (const port of options.ports) {
    portSuccessCounts[port] = 0;
  }

  const resumeFn = options.resume ?? options.run;
  let explored = 0;

  for (const failingPorts of combos) {
    explored += 1;
    const remaining: Record<string, number> = {};
    for (const port of options.ports) {
      remaining[port] = 0;
    }
    for (const port of failingPorts) {
      remaining[port] = 1;
    }
    const calls: string[] = [];
    const faults: FaultController = {
      failingPorts,
      remaining,
      calls,
      failIfArmed(port: string): void {
        if (!declaredPorts.has(port)) {
          throw new Error(`Unknown port in fault controller: ${port}`);
        }
        if ((remaining[port] ?? 0) > 0) {
          remaining[port] -= 1;
          calls.push(`${port}:FAIL`);
          throw new Error(`Injected failure on port: ${port}`);
        }
        calls.push(port);
        portSuccessCounts[port] += 1;
      },
    };

    withFreshWorld(
      () => options.newWorld(faults),
      options.disposeWorld,
      (world) => {
        try {
          options.run(world);
          stepSuccessCounts.initial += 1;
        } catch {
          // Initial run failure is expected when a fault is injected.
        }

        for (let attempt = 0; attempt < options.resumes; attempt++) {
          try {
            resumeFn(world);
            stepSuccessCounts.resume += 1;
          } catch {
            // Resume failure is allowed if a later port still fails.
          }
        }

        const failure = options.check(world, faults);
        if (failure !== null) {
          violations.push({
            sequence: failingPorts,
            failingPorts,
            calls: [...calls],
            reason: failure.reason,
            ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
          });
        }
      },
    );
  }

  return {
    explored,
    violations,
    shortestFailure: violations[0] ?? null,
    stepSuccessCounts,
    portSuccessCounts,
  };
}
