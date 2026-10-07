// The Workers Vitest runtime's entrypoint. It is the real Worker plus the test-only `TestHarnessDO` used by the
// harness and adapter specs, so `SELF.fetch` drives the actual Worker into the Durable Object (slice 10b AC4).
export { default } from "./worker.js";
export * from "./worker.js";
export { TestHarnessDO } from "./test-harness-do.js";
