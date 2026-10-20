import test from "node:test";

// Fixture for test/browser-phase-timeout.test.ts: sleeps far longer than the overridden per-file timeout, so the runner must kill it.
test("sleeps longer than the browser file timeout", async () => {
  await new Promise((resolve) => setTimeout(resolve, 120_000));
});
