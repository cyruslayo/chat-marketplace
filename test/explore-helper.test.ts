import test from "node:test";
import assert from "node:assert/strict";
import { exploreFailures, exploreOrders } from "./helpers/explore.js";

interface FakeOrderWorld {
  stage: "idle" | "armed" | "disarmed";
  fired: boolean;
  firedWhileArmed: boolean;
  readonly worldInstanceId: number;
}

function createFakeOrderWorldFactory() {
  let nextId = 0;
  return () => ({
    stage: "idle" as const,
    fired: false,
    firedWhileArmed: false,
    worldInstanceId: ++nextId,
  });
}

test("AC1: The helper explores every order up to the depth and reports the shortest failing sequence first", () => {
  const newWorld = createFakeOrderWorldFactory();
  const seenWorldIds = new Set<number>();

  const buggyResult = exploreOrders<FakeOrderWorld, { readonly worldInstanceId: number }>({
    steps: [
      {
        name: "arm",
        run: (w) => {
          seenWorldIds.add(w.worldInstanceId);
          if (w.stage === "armed") throw new Error("already armed");
          w.stage = "armed";
        },
      },
      {
        name: "fire",
        run: (w) => {
          seenWorldIds.add(w.worldInstanceId);
          if (w.stage === "armed") {
            w.firedWhileArmed = true;
          }
          w.fired = true;
        },
      },
      {
        name: "disarm",
        run: (w) => {
          seenWorldIds.add(w.worldInstanceId);
          w.stage = "disarmed";
        },
      },
    ],
    depth: 3,
    prune: false,
    newWorld,
    check: {
      reads: ["firedWhileArmed"],
      verify: (w) =>
        w.firedWhileArmed
          ? { reason: "fired while armed", detail: { worldInstanceId: w.worldInstanceId } }
          : null,
    },
  });

  // 3 + 9 + 27 = 39 orders
  assert.equal(buggyResult.explored, 39);
  assert.equal(seenWorldIds.size, 39);
  assert.ok(buggyResult.violations.length > 0);
  assert.deepEqual(buggyResult.shortestFailure?.sequence, ["arm", "fire"]);
  assert.deepEqual(buggyResult.violations[0], buggyResult.shortestFailure);
  for (let i = 1; i < buggyResult.violations.length; i++) {
    assert.ok(buggyResult.violations[i]!.sequence.length >= buggyResult.violations[i - 1]!.sequence.length);
  }
  assert.ok(buggyResult.stepSuccessCounts.arm! > 0);
  assert.ok(buggyResult.stepSuccessCounts.fire! > 0);
  assert.ok(buggyResult.stepSuccessCounts.disarm! > 0);

  // Failure path: a correct machine whose check never fails reports zero violations with per-step success counts.
  const cleanResult = exploreOrders<FakeOrderWorld>({
    steps: [
      {
        name: "arm",
        run: (w) => {
          w.stage = "armed";
        },
      },
      {
        name: "fire",
        run: (w) => {
          if (w.stage === "armed") throw new Error("cannot fire while armed");
          w.fired = true;
        },
      },
      {
        name: "disarm",
        run: (w) => {
          w.stage = "disarmed";
        },
      },
    ],
    depth: 3,
    prune: false,
    newWorld: createFakeOrderWorldFactory(),
    check: {
      reads: ["firedWhileArmed"],
      verify: (w) => (w.firedWhileArmed ? { reason: "fired while armed" } : null),
    },
  });

  assert.equal(cleanResult.explored, 39);
  assert.equal(cleanResult.violations.length, 0);
  assert.equal(cleanResult.shortestFailure, null);
  assert.deepEqual(cleanResult.stepSuccessCounts, {
    arm: 13,
    fire: 8,
    disarm: 13,
  });
});

test("AC2: A step declared required that never succeeds in any order fails the test", () => {
  const okResult = exploreOrders<{ done: boolean }>({
    steps: [
      {
        name: "prepare",
        required: true,
        run: (w) => {
          w.done = true;
        },
      },
      {
        name: "noop",
        run: () => {},
      },
    ],
    depth: 2,
    prune: false,
    newWorld: () => ({ done: false }),
    check: {
      reads: ["done"],
      verify: () => null,
    },
  });
  assert.equal(okResult.violations.length, 0);
  assert.ok(okResult.stepSuccessCounts.prepare! > 0);

  assert.throws(
    () =>
      exploreOrders<{ done: boolean }>({
        steps: [
          {
            name: "prepare",
            run: (w) => {
              w.done = true;
            },
          },
          {
            name: "blocked_step",
            required: true,
            run: () => {
              throw new Error("always refused");
            },
          },
        ],
        depth: 2,
        prune: false,
        newWorld: () => ({ done: false }),
        check: {
          reads: ["done"],
          verify: () => null,
        },
      }),
    /Required step\(s\) never succeeded.*blocked_step/,
  );
});

test("AC3: The failure explorer fails each port once, in every combination, then resumes the given number of times", () => {
  interface PortWorld {
    aDone: boolean;
    bDone: boolean;
    cDone: boolean;
    attempts: number;
  }

  const seenCombinations: string[] = [];
  const callTraces: readonly (readonly string[])[] = [];

  const buggyResult = exploreFailures<PortWorld>({
    ports: ["a", "b", "c"],
    resumes: 2,
    newWorld: (faults) => {
      seenCombinations.push(faults.failingPorts.join(","));
      return { aDone: false, bDone: false, cDone: false, attempts: 0 };
    },
    run: (w) => {
      w.attempts += 1;
    },
    resume: undefined,
    check: () => null,
  });
  assert.equal(buggyResult.explored, 8);
  assert.equal(seenCombinations.length, 8);
  assert.deepEqual(seenCombinations, ["", "a", "b", "c", "a,b", "a,c", "b,c", "a,b,c"]);
  assert.equal(callTraces.length, 0);

  const attemptCountsByCombo: number[] = [];
  const stuckResult = exploreFailures<{ aDone: boolean; bDone: boolean; cDone: boolean; attempts: number; readonly faults: { failIfArmed(p: string): void } }>({
    ports: ["a", "b", "c"],
    resumes: 2,
    newWorld: (faults) => ({ aDone: false, bDone: false, cDone: false, attempts: 0, faults }),
    run: (w) => {
      w.attempts += 1;
      if (w.attempts > 1) throw new Error("no resume supported");
      w.faults.failIfArmed("a");
      w.aDone = true;
      w.faults.failIfArmed("b");
      w.bDone = true;
      w.faults.failIfArmed("c");
      w.cDone = true;
    },
    check: (w) => {
      attemptCountsByCombo.push(w.attempts);
      return w.aDone && w.bDone && w.cDone
        ? null
        : { reason: "unfinished after resumes" };
    },
  });

  assert.equal(stuckResult.explored, 8);
  assert.deepEqual(attemptCountsByCombo, [3, 3, 3, 3, 3, 3, 3, 3]);
  assert.equal(stuckResult.violations.length, 7);
  assert.equal(stuckResult.shortestFailure?.failingPorts.length, 1);
  assert.equal(stuckResult.stepSuccessCounts.initial, 1);
  assert.equal(stuckResult.stepSuccessCounts.resume, 0);

  // Resumable machine: each port fails at most once, so 3 resumes (4 total attempts) finish all 8 combinations.
  const fixedResult = exploreFailures<{ aDone: boolean; bDone: boolean; cDone: boolean; readonly faults: { failIfArmed(p: string): void } }>({
    ports: ["a", "b", "c"],
    resumes: 3,
    newWorld: (faults) => ({ aDone: false, bDone: false, cDone: false, faults }),
    run: (w) => {
      if (!w.aDone) {
        w.faults.failIfArmed("a");
        w.aDone = true;
      }
      if (!w.bDone) {
        w.faults.failIfArmed("b");
        w.bDone = true;
      }
      if (!w.cDone) {
        w.faults.failIfArmed("c");
        w.cDone = true;
      }
    },
    check: (w) => (w.aDone && w.bDone && w.cDone ? null : { reason: "unfinished" }),
  });

  assert.equal(fixedResult.explored, 8);
  assert.equal(fixedResult.violations.length, 0);
  assert.equal(fixedResult.shortestFailure, null);
  assert.ok(fixedResult.portSuccessCounts.a! >= 8);
  assert.ok(fixedResult.portSuccessCounts.b! >= 8);
  assert.ok(fixedResult.portSuccessCounts.c! >= 8);

  assert.throws(
    () =>
      exploreFailures({
        ports: ["a"],
        resumes: -1,
        newWorld: () => ({}),
        run: () => {},
        check: () => null,
      }),
    /non-negative integer/,
  );
});

test("AC6: The helper compares a caller-supplied digest after each prefix, prunes already-explored states and refused no-ops, and guards against digests omitting fields the check reads", () => {
  interface HiddenFlagWorld {
    stage: "init" | "ready";
    armed: boolean;
    triggered: boolean;
    refusedMutated: boolean;
  }

  const steps = [
    {
      name: "prepare_safe",
      run: (w: HiddenFlagWorld) => {
        if (w.stage !== "init") throw new Error("already ready");
        w.stage = "ready";
      },
    },
    {
      name: "prepare_armed",
      run: (w: HiddenFlagWorld) => {
        if (w.stage !== "init") throw new Error("already ready");
        w.stage = "ready";
        w.armed = true;
      },
    },
    {
      name: "noop_refused",
      run: () => {
        throw new Error("always refused without change");
      },
    },
    {
      name: "mutating_refused",
      run: (w: HiddenFlagWorld) => {
        if (w.refusedMutated) throw new Error("already mutated");
        w.refusedMutated = true;
        throw new Error("refused after mutating");
      },
    },
    {
      name: "trigger",
      run: (w: HiddenFlagWorld) => {
        if (w.stage === "ready" && w.armed) {
          w.triggered = true;
        }
      },
    },
  ] as const;

  const newWorld = (): HiddenFlagWorld => ({
    stage: "init",
    armed: false,
    triggered: false,
    refusedMutated: false,
  });

  // 1. Complete digest with pruning lowers explored count, does not extend refused no-ops,
  // still extends refused steps that mutated state, and matches unpruned shortestFailure.
  const completeDigest = {
    fields: ["stage", "armed", "triggered", "refusedMutated"] as const,
    read: (w: HiddenFlagWorld) => ({
      stage: w.stage,
      armed: w.armed,
      triggered: w.triggered,
      refusedMutated: w.refusedMutated,
    }),
  };
  const completeCheck = {
    reads: ["stage", "armed", "triggered"] as const,
    verify: (w: HiddenFlagWorld) => (w.triggered ? { reason: "triggered while armed" } : null),
  };

  const unpruned = exploreOrders({
    steps,
    depth: 3,
    prune: false,
    newWorld,
    check: completeCheck,
  });
  const pruned = exploreOrders({
    steps,
    depth: 3,
    prune: true,
    digest: completeDigest,
    newWorld,
    check: completeCheck,
  });

  assert.ok(pruned.explored < unpruned.explored);
  assert.ok(pruned.pruned > 0);
  assert.deepEqual(pruned.shortestFailure?.sequence, ["prepare_armed", "trigger"]);
  assert.deepEqual(pruned.shortestFailure?.sequence, unpruned.shortestFailure?.sequence);

  // Verify a refused step that mutated state was extended (e.g. ["prepare_armed", "mutating_refused", "trigger"]).
  assert.ok(
    pruned.violations.some(
      (v) => v.sequence.includes("mutating_refused") && v.sequence.includes("trigger"),
    ),
  );
  // Verify a refused no-op at depth 1 was NOT extended to depth 2 or 3.
  assert.ok(!pruned.violations.some((v) => v.sequence[0] === "noop_refused"));

  // 2. Failure path demonstration: omitting `armed` from the digest (and check.reads) collapses
  // `prepare_armed` into `prepare_safe`, hiding the seeded defect completely.
  const incompleteResult = exploreOrders({
    steps: [steps[0], steps[1], steps[4]],
    depth: 2,
    prune: true,
    digest: {
      fields: ["stage", "triggered"],
      read: (w: HiddenFlagWorld) => ({ stage: w.stage, triggered: w.triggered }),
    },
    newWorld,
    check: {
      reads: ["stage", "triggered"],
      verify: (w: HiddenFlagWorld) => (w.triggered ? { reason: "triggered while armed" } : null),
    },
  });
  assert.equal(incompleteResult.violations.length, 0);

  // 3. Helper guard: when the check declares it reads `armed` and the digest omits it, exploreOrders fails closed.
  assert.throws(
    () =>
      exploreOrders({
        steps: [steps[0], steps[1], steps[4]],
        depth: 2,
        prune: true,
        digest: {
          fields: ["stage", "triggered"],
          read: (w: HiddenFlagWorld) => ({ stage: w.stage, triggered: w.triggered }),
        },
        newWorld,
        check: {
          reads: ["stage", "armed", "triggered"],
          verify: (w: HiddenFlagWorld) => (w.triggered ? { reason: "triggered while armed" } : null),
        },
      }),
    /Digest omits field\(s\) read by check: armed/,
  );

  // 4. Runtime guard: when digest declares `armed` in fields but omits it from read() output, exploreOrders fails closed.
  assert.throws(
    () =>
      exploreOrders({
        steps: [steps[0], steps[1], steps[4]],
        depth: 2,
        prune: true,
        digest: {
          fields: ["stage", "armed", "triggered"],
          read: (w: HiddenFlagWorld) =>
            ({ stage: w.stage, triggered: w.triggered }) as unknown as Record<
              string,
              string | number | boolean | null
            >,
        },
        newWorld,
        check: completeCheck,
      }),
    /Digest runtime output omitted declared field: armed/,
  );
});
