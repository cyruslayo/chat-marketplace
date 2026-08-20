import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { JsonUnitRepository } from "../domains/shortlet/src/index.js";
import { conventionalSearch, conventionalSearchRoute } from "../apps/web/src/index.js";
import { createWebAgentAdapter } from "../apps/web-agent/src/index.js";
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

test("default web-agent presentation exposes deterministic A2UI with conventional parity", () => {
  const deps = setup();
  const filters = Object.freeze({ location: "Lagos" });
  const query = new UnitDiscoveryQuery({
    ...deps,
    clock: () => new Date("2026-07-22T00:00:00Z"),
    idFactory: () => "fixed-id",
  });
  const conventional = conventionalSearch(query, filters);
  const result = createWebAgentAdapter({ query, createSurfaceId: () => "application-surface" }).search(filters);
  assert.deepEqual(result.artifact.facts, conventional.artifact.facts);
  assert.equal(result.channel, "web-agent");
  assert.equal(conventional.channel, "web");
  assert.equal(result.fallback.message, "Found 1 eligible Unit.");
  assert.equal(result.fallback.conventionalRoute, conventionalSearchRoute(filters));
  assert.ok(result.a2uiMessages.length > 0);
  assert.equal(result.surfaceId, "application-surface");
});

test("default presenter preserves authoritative filters structurally", () => {
  const deps = setup();
  const filters = Object.freeze({ location: "Lagos" });
  const receivedFilters: Readonly<Record<string, unknown>>[] = [];
  const authoritativeQuery = new UnitDiscoveryQuery({
    ...deps,
    clock: () => new Date("2026-07-22T00:00:00Z"),
    idFactory: () => "authoritative-artifact",
  });
  const query = {
    search(requestedFilters: Readonly<Record<string, unknown>>) {
      receivedFilters.push(requestedFilters);
      return authoritativeQuery.search(requestedFilters);
    },
  };
  const result = createWebAgentAdapter({ query, createSurfaceId: () => "authority-surface" }).search(filters);
  assert.deepEqual(receivedFilters, [filters]);
  assert.deepEqual(result.artifact.facts.filters, filters);
  assert.deepEqual(result.artifact.facts.results.map((unit: any) => unit.id), ["unit-lagos-001"]);
  assert.ok(result.a2uiMessages.length > 0);
  assert.equal(result.fallback.conventionalRoute, conventionalSearchRoute(filters));
  assert.equal("agentRun" in result, false);
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
