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
    maxPriceKobo: 9000000
  });
  assert.deepEqual(results.map((unit) => unit.id), ["unit-lagos-001"]);
  assert.equal(results[0].trust.inspection, "current");
  assert.equal(results[0].price.allInStayTotalKobo, 18000000);
});

test("rejects stays outside launch duration and booking horizon", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.throws(() => query.search({ checkIn: "2026-07-23", checkOut: "2026-08-07" }), /14 nights/);
  assert.throws(() => query.search({ checkIn: "2026-10-21", checkOut: "2026-10-22" }), /90-day/);
});

test("evidence must remain current through checkout", () => {
  const deps = setup();
  const expiring = { ...deps.repository.findAll()[0], inspection: { status: "passed", expiresAt: "2026-08-11" } };
  deps.repository.save(expiring);
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.equal(query.search({ checkIn: "2026-08-10", checkOut: "2026-08-12" }).length, 0);
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
  assert.equal(query.search({ checkIn: "2026-08-11", checkOut: "2026-08-13" }).length, 0);
});

test("conventional and conversational presentations expose equivalent authoritative facts", () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const filters = { location: "Lagos", partySize: 2 };
  const conventional = conventionalSearch(query, filters);
  const conversational = conversationalSearch(query, filters);
  assert.deepEqual(conventional.results, conversational.results);
  assert.equal(conversational.message, "Found 1 eligible Unit.");
});

test("CopilotKit adapter delegates intent handling but returns the same canonical result", async () => {
  const deps = setup();
  const query = new UnitDiscoveryQuery({ ...deps, clock: () => new Date("2026-07-22T00:00:00Z") });
  const adapter = createCopilotKitWebAgentAdapter({
    query,
    runtime: { run: async ({ filters }) => ({ filters }) }
  });
  const result = await adapter.search({ location: "Lagos" });
  assert.deepEqual(result.results, conventionalSearch(query, { location: "Lagos" }).results);
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
  const applicationSource = await readFile(fileURLToPath(new URL("../domains/shortlet/src/index.js", import.meta.url)), "utf8");
  assert.doesNotMatch(applicationSource, /copilotkit/i);
});
