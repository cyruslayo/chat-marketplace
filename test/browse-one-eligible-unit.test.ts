import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { JsonUnitRepository } from "../domains/shortlet/src/index.js";
import { conventionalSearch } from "../apps/web/src/index.js";
import { conversationalSearch, createCopilotKitWebAgentAdapter } from "../apps/web-agent/src/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return { repository, audit: new InMemoryAuditLog(), telemetry: new InMemoryTelemetry() };
}

test("date, party-size, location, amenity, and price filters return only eligible matching Units", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const results = query.search({
    checkIn: "2026-08-10T14:00:00Z",
    checkOut: "2026-08-12T11:00:00Z",
    partySize: 3,
    location: "Lagos",
    amenity: "wifi",
    minPriceKobo: 8000000,
    maxPriceKobo: 19000000
  });
  assert.deepEqual(results.facts.results.map((unit: any) => unit.id), ["unit-lagos-001"]);
  assert.equal(results.facts.results[0].trust.inspection.status, "current");
  assert.equal(results.facts.results[0].price.allInStayTotalKobo, 18000000);
  assert.equal(results.facts.results[0].price.amountDueNowKobo, 23000000);
  assert.equal(results.schemaVersion, "shortlet.discovery/v1");
  assert.equal(results.sensitivity, "public");
});

test("dated budget filters use the All-In Stay Total, not the nightly rate", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const artifact = query.search({
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    partySize: 2,
    maxPriceKobo: 9000000
  });
  assert.deepEqual(artifact.facts.results, []);
  assert.throws(() => query.search({ maxPriceKobo: 9000000 }), /dates and partySize/);
});

test("rejects stays outside launch duration and booking horizon", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.throws(() => query.search({ checkIn: "2026-07-23", checkOut: "2026-08-07" }), /14 nights/);
  assert.throws(() => query.search({ checkIn: "2026-10-21", checkOut: "2026-10-22" }), /90-day/);
});

test("evidence must remain current through checkout", () => {
  const deps = setup();
  const unit = deps.repository.findAll()[0];
  const expiring = { ...unit, inspection: { ...unit.inspection, expiresAt: "2026-08-11" } };
  deps.repository.save(expiring);
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.equal(query.search({ checkIn: "2026-08-10", checkOut: "2026-08-12" }).facts.results.length, 0);
});

test("all mandatory regulatory and operator evidence must remain eligible through checkout", () => {
  const deps = setup();
  const unit = deps.repository.findAll()[0];
  deps.repository.save({ ...unit, regulatory: { ...unit.regulatory, insurance: { ...unit.regulatory.insurance, status: "pending" } } });
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.equal(query.search({ checkIn: "2026-08-10", checkOut: "2026-08-12" }).facts.results.length, 0);
});

test("future-dated evidence cannot make a Unit currently eligible", () => {
  const deps = setup();
  const unit = deps.repository.findAll()[0];
  deps.repository.save({ ...unit, inspection: { ...unit.inspection, inspectedAt: "2026-08-11" } });
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.equal(query.search({ checkIn: "2026-08-12", checkOut: "2026-08-13" }).facts.results.length, 0);
});

test("unit persistence survives a repository instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-"));
  try {
    const file = join(directory, "units.json");
    seedIssue01Units(new JsonUnitRepository(file));
    assert.equal(new JsonUnitRepository(file).findAll().length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authoritative availability excludes overlapping dates", () => {
  const deps = setup();
  deps.repository.save({ ...deps.repository.findAll()[0], blockedDates: [{ start: "2026-08-10", end: "2026-08-12" }] });
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.equal(query.search({ checkIn: "2026-08-11", checkOut: "2026-08-13" }).facts.results.length, 0);
});

test("booking horizon uses Africa/Lagos calendar days", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T23:30:00Z") });
  const artifact = query.search({ checkIn: "2026-07-23", checkOut: "2026-07-24" });
  assert.equal(artifact.facts.results.length, 1);
});

test("conventional and conversational presentations expose equivalent authoritative facts", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z"), idFactory: () => "fixed-id" });
  const conventional = conventionalSearch(query, { location: "Lagos" });
  const conversational = conversationalSearch(query, { location: "Lagos" });
  assert.deepEqual(conversational.artifact, conventional.artifact);
  assert.equal(conversational.channel, "web-agent");
  assert.equal(conventional.channel, "web");
  assert.match(conversational.message, /1 eligible Unit/);
});

test("CopilotKit adapter delegates intent handling but returns the same canonical result", async () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const adapter = createCopilotKitWebAgentAdapter({
    query,
    runtime: { present: async ({ artifact }: any) => ({ artifactId: artifact.id, message: "One matching stay." }) }
  });
  const result = await adapter.search({ location: "Lagos" });
  assert.deepEqual(result.artifact.facts, conventionalSearch(query, { location: "Lagos" }).artifact.facts);
  assert.equal(result.message, "One matching stay.");
  assert.equal(result.agentRun, "completed");
});

test("agent output cannot rewrite authoritative filters and failures use deterministic fallback", async () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const mutating = createCopilotKitWebAgentAdapter({
    query,
    runtime: { present: async () => ({ message: "Changed", filters: { location: "Abuja" } }) }
  });
  const result = await mutating.search({ location: "Lagos" });
  assert.equal(result.artifact.facts.filters.location, "Lagos");
  assert.deepEqual(result.artifact.facts.results.map((unit: any) => unit.id), ["unit-lagos-001"]);

  const failing = createCopilotKitWebAgentAdapter({ query, runtime: { present: async () => { throw new Error("offline"); } } });
  const fallback = await failing.search({ location: "Lagos" });
  assert.equal(fallback.fallback.conventionalRoute, "/stays/search?location=Lagos");
});

test("search records an audit trail and telemetry without exposing source records", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  query.search({ location: "Abuja" });
  assert.equal(deps.audit.entries()[0].type, "unit.search");
  assert.deepEqual(deps.audit.entries()[0].resultUnitIds, []);
  assert.deepEqual(deps.telemetry.events()[0], {
    type: "unit.search.completed",
    queryId: deps.telemetry.events()[0].queryId,
    resultCount: 0,
    recordedAt: deps.telemetry.events()[0].recordedAt
  });
});

test("application contract contains no CopilotKit dependency", async () => {
  const contractUrls = [
    new URL("../domains/shortlet/src/index.ts", import.meta.url),
    new URL("../domains/shortlet/src/browse.ts", import.meta.url),
    new URL("../packages/platform-core/src/index.ts", import.meta.url)
  ];
  const applicationSources = await Promise.all(contractUrls.map((url) => readFile(fileURLToPath(url), "utf8")));
  for (const source of applicationSources) assert.doesNotMatch(source, /copilotkit/i);
});

test("canonical artifacts are deeply immutable", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const artifact = query.search({ location: "Lagos" });
  assert.throws(() => { (artifact.facts.filters as any).location = "Abuja"; }, TypeError);
  assert.throws(() => { (artifact.facts.results[0] as any).price.nightlyKobo = 1; }, TypeError);
});

test("CopilotKit infrastructure adapter loads independently of the Domain Pack", async () => {
  const runtimeModule = await import("../apps/web-agent/src/copilotkit-runtime.js");
  assert.equal(typeof runtimeModule.createCopilotKitRuntime, "function");
  assert.deepEqual(runtimeModule.AG_UI_PROFILE, {
    id: "ag-ui/0.0.57-shortlet-launch-v1", protocolVersion: "0.0.57",
    transport: "https-post-sse", artifactSchema: "shortlet.discovery/v1",
    allowedInboundMessageRoles: ["assistant"]
  });
});

test("CopilotKit runtime emits the pinned AG-UI profile and correlates its response", async () => {
  const { createCopilotKitRuntime, AG_UI_PROFILE } = await import("../apps/web-agent/src/copilotkit-runtime.js");
  const agent = {
    messages: [] as any[],
    addMessage(message: any) { this.messages.push(message); }
  };
  let forwardedProps: any;
  const runtime = createCopilotKitRuntime({
    coreFactory: () => ({
      connect() {},
      getAgent: () => agent,
      subscribe: () => ({ unsubscribe() {} }),
      async runAgent({ forwardedProps: props }: any) {
        forwardedProps = props;
        agent.messages.push({ id: "assistant-1", role: "assistant", content: "One eligible Unit." });
      }
    })
  });
  const artifact = Object.freeze({ id: "artifact-1", schemaVersion: "shortlet.discovery/v1" });
  const result = await runtime.present({ intent: "browse-eligible-unit", artifact });
  assert.equal(result.artifactId, artifact.id);
  assert.equal(result.message, "One eligible Unit.");
  assert.deepEqual(forwardedProps?.agUiProfile, AG_UI_PROFILE);
  assert.equal(agent.messages[0].role, "user");
});

test("CopilotKit runtime never correlates stale narration to a new artifact", async () => {
  const { createCopilotKitRuntime } = await import("../apps/web-agent/src/copilotkit-runtime.js");
  const agent = {
    messages: [{ id: "old", role: "assistant", content: "Stale result." }] as any[],
    addMessage(message: any) { this.messages.push(message); }
  };
  const runtime = createCopilotKitRuntime({
    coreFactory: () => ({
      connect() {}, getAgent: () => agent,
      subscribe: () => ({ unsubscribe() {} }), async runAgent() {}
    })
  });
  const result = await runtime.present({
    intent: "browse-eligible-unit",
    artifact: Object.freeze({ id: "artifact-2", schemaVersion: "shortlet.discovery/v1" })
  });
  assert.equal(result.message, undefined);
});
