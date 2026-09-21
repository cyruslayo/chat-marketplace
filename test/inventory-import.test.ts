import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JsonUnitRepository,
  UnitDiscoveryQuery,
  UnitRepository,
  getUnitOnboardingStatus,
  onboardOperator,
  publishUnit,
  type Unit,
} from "../domains/shortlet/src/index.js";
import {
  importInventoryCsv,
  operatorResolverFromUnitRepository,
} from "../domains/shortlet/src/inventory-import.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

const NOW = new Date("2026-09-21T10:00:00.000Z");

function operator() {
  return onboardOperator({
    id: "operator-pilot-001",
    name: "Pilot Accommodation Ltd",
    legalForm: "private-company-limited-by-shares",
    cacVerified: true,
    responsiblePersonsVerified: true,
    beneficialOwnersVerified: true,
    paymentProviderApproved: true,
    settlementAccountVerified: true,
    approvedAt: "2026-01-01",
    approvalExpiresAt: "2027-12-31",
  });
}

function anchor(repository: UnitRepository, overrides: Partial<Unit> = {}) {
  repository.save({
    id: "operator-anchor",
    propertyId: "property-anchor",
    title: "Existing Operator Anchor",
    location: { city: "Lagos", neighbourhood: "Ikeja" },
    occupancyModel: "entire-place",
    capacity: 2,
    amenities: [],
    published: false,
    price: { nightlyKobo: 1, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0, version: "anchor" },
    operator: operator(),
    inspection: null,
    managementAuthority: null,
    regulatory: null,
    blockedDates: [],
    ...overrides,
  });
}

function csvRow(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    external_listing_id: "sheet-lagos-001",
    unit_id: "unit-import-001",
    property_id: "property-import-001",
    operator_id: "operator-pilot-001",
    title: "Bright apartment in Ikeja",
    description: "A bright entire-place apartment with a quiet living room and reliable power.",
    city: "Lagos",
    neighbourhood: "Ikeja",
    capacity: "4",
    bedrooms: "2",
    bathrooms: "2",
    nightly_price_ngn: "120000",
    mandatory_fees_ngn: "10000",
    refundable_security_deposit_ngn: "50000",
    currency: "NGN",
    amenities: "wifi|generator|parking",
    photo_urls: "",
    blocked_dates: "2026-12-24/2026-12-26",
    inspection_status: "passed",
    inspection_date: "2026-08-01",
    inspection_expiry: "2027-08-01",
    inspection_scope: "entire-place-possession|structure-and-sanitation|fire-and-emergency-readiness|electrical-and-utilities|locks-and-privacy|access-controls|cameras|listing-accuracy|current-media",
    inspection_material_change_pending: "false",
    management_authority_status: "verified",
    management_authority_date: "2026-08-01",
    management_authority_expiry: "2027-08-01",
    management_authority_permissions: "advertise|accept-bookings|contract-guests|provide-access|collect-revenue|manage-cancellations|issue-refunds|manage-incidents",
    licensing_status: "verified",
    licensing_date: "2026-08-01",
    licensing_expiry: "2027-08-01",
    insurance_status: "verified",
    insurance_date: "2026-08-01",
    insurance_expiry: "2027-08-01",
    insurance_public_liability_ngn: "10000000",
    insurance_annual_aggregate_ngn: "20000000",
    insurance_property_cover_verified: "true",
    cancellation_policy: "standard",
    ...overrides,
  };
  const headers = Object.keys(values);
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return { headers, line: headers.map((header) => escape(values[header] ?? "")).join(",") };
}

function csv(rows: string[]) {
  const first = csvRow();
  return [first.headers.join(","), ...rows].join("\n");
}

function setup() {
  const repository = new UnitRepository();
  anchor(repository);
  const audit = { entries: [] as Record<string, unknown>[], record(entry: Record<string, unknown>) { this.entries.push(entry); } };
  return { repository, operatorResolver: operatorResolverFromUnitRepository(repository), audit };
}

function run(repository: UnitRepository, contents: string, options: { dryRun?: boolean; audit?: { record(entry: Record<string, unknown>): void } } = {}) {
  return importInventoryCsv(contents, {
    repository,
    operatorResolver: operatorResolverFromUnitRepository(repository),
    clock: () => NOW,
    ...options,
  });
}

test("AC1 — dry-run writes no inventory", () => {
  const { repository } = setup();
  const before = repository.findAll();
  const result = run(repository, csv([csvRow().line]), { dryRun: true });
  assert.equal(result.imported, 0);
  assert.deepEqual(repository.findAll(), before);
});

test("AC2 — a valid Unit imports successfully", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow().line]));
  assert.equal(result.inserted, 1);
  assert.equal(repository.findById("unit-import-001")?.price.nightlyKobo, 12_000_000);
  assert.equal(repository.findById("unit-import-001")?.published, false);
});

test("AC3 — the same file can be re-imported without duplication", () => {
  const { repository } = setup();
  const contents = csv([csvRow().line]);
  run(repository, contents);
  const result = run(repository, contents);
  assert.equal(result.inserted, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(repository.findAll().filter((unit) => unit.id === "unit-import-001").length, 1);
});

test("AC4 — a changed Unit updates the existing record", () => {
  const { repository } = setup();
  const first = csvRow();
  run(repository, csv([first.line]));
  const changed = csvRow({ title: "Updated Ikeja apartment", nightly_price_ngn: "135000", neighbourhood: "GRA Ikeja" });
  const result = run(repository, csv([changed.line]));
  assert.equal(result.updated, 1);
  assert.equal(repository.findById("unit-import-001")?.title, "Updated Ikeja apartment");
  assert.equal(repository.findById("unit-import-001")?.price.nightlyKobo, 13_500_000);
});

test("AC5 — malformed rows are rejected with useful errors", () => {
  const { repository } = setup();
  const row = csvRow({ capacity: "four" });
  const result = run(repository, csv([row.line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /capacity/i);
  assert.equal(result.errors[0]?.row, 2);
});

test("AC6 — unsupported cities are rejected", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ city: "Ibadan" }).line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /Lagos or Abuja/);
});

test("AC7 — invalid money is rejected", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ nightly_price_ngn: "-120000" }).line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /nightly_price_ngn.*non-negative|money/i);
});

test("AC8 — missing Operator references fail safely", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ operator_id: "operator-missing" }).line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /Operator.*operator-missing.*not found/i);
  assert.equal(repository.findById("unit-import-001"), null);
});

test("AC9 — import does not automatically publish a Unit", () => {
  const { repository } = setup();
  run(repository, csv([csvRow().line]));
  assert.equal(repository.findById("unit-import-001")?.published, false);
});

test("AC10 — incomplete eligibility claims prevent publication", () => {
  const { repository } = setup();
  run(repository, csv([csvRow({ inspection_status: "passed", inspection_expiry: "" }).line]));
  const unit = repository.findById("unit-import-001")!;
  assert.equal(getUnitOnboardingStatus(unit, NOW).eligibleForPublication, false);
});

test("AC11 — expired inspection prevents publication", () => {
  const { repository } = setup();
  run(repository, csv([csvRow({ inspection_expiry: "2026-09-20" }).line]));
  const unit = repository.findById("unit-import-001")!;
  assert.equal(getUnitOnboardingStatus(unit, NOW).eligibleForPublication, false);
  assert.throws(() => publishUnit(repository, unit.id, { clock: () => NOW }), /inspection/i);
});

test("AC12 — invalid Management Authority prevents publication", () => {
  const { repository } = setup();
  run(repository, csv([csvRow({ management_authority_status: "revoked" }).line]));
  const unit = repository.findById("unit-import-001")!;
  assert.equal(getUnitOnboardingStatus(unit, NOW).eligibleForPublication, false);
  assert.throws(() => publishUnit(repository, unit.id, { clock: () => NOW }), /authority/i);
});

test("AC13 — an eligible imported Unit can use the existing publication path", () => {
  const { repository } = setup();
  run(repository, csv([csvRow().line]));
  assert.equal(publishUnit(repository, "unit-import-001", { clock: () => NOW }).published, true);
});

test("AC14 — a published imported Lagos Unit appears in Guest discovery", () => {
  const { repository } = setup();
  run(repository, csv([csvRow().line]));
  publishUnit(repository, "unit-import-001", { clock: () => NOW });
  const results = new UnitDiscoveryQuery({ repository, audit: { record() {} }, telemetry: { track() {} }, clock: () => NOW }).search({ location: "Lagos" });
  assert.deepEqual(results.facts.results.map((unit: { id: string }) => unit.id), ["unit-import-001"]);
});

test("AC15 — a published imported Abuja Unit appears in Guest discovery", () => {
  const { repository } = setup();
  run(repository, csv([csvRow({ city: "Abuja", neighbourhood: "Wuse 2", unit_id: "unit-abuja-001", property_id: "property-abuja-001", external_listing_id: "sheet-abuja-001" }).line]));
  publishUnit(repository, "unit-abuja-001", { clock: () => NOW });
  const results = new UnitDiscoveryQuery({ repository, audit: { record() {} }, telemetry: { track() {} }, clock: () => NOW }).search({ location: "Abuja" });
  assert.deepEqual(results.facts.results.map((unit: { id: string }) => unit.id), ["unit-abuja-001"]);
});

test("AC1/AC2/AC3/AC4 — valid imported photos preserve ordered URLs and make the first URL primary", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ photo_urls: "https://images.example/cover.jpg|https://images.example/second.jpg" }).line]));
  assert.equal(result.invalid, 0);
  assert.deepEqual(repository.findById("unit-import-001")?.photoUrls, [
    "https://images.example/cover.jpg",
    "https://images.example/second.jpg",
  ]);
  assert.equal(repository.findById("unit-import-001")?.photoUrls[0], "https://images.example/cover.jpg");
  assert.equal(repository.findById("unit-import-001")?.description, "A bright entire-place apartment with a quiet living room and reliable power.");
  assert.equal(repository.findById("unit-import-001")?.bathrooms, 2);
});

test("AC1 — a Unit imports with valid description and bathroom count", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow().line]));
  assert.equal(result.invalid, 0);
  assert.equal(repository.findById("unit-import-001")?.description, "A bright entire-place apartment with a quiet living room and reliable power.");
  assert.equal(repository.findById("unit-import-001")?.bathrooms, 2);
});

test("AC2 — missing description fails import and does not write the Unit", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ description: "" }).line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /description is required/);
  assert.equal(repository.findById("unit-import-001"), null);
});

test("AC3 — overlong description is rejected", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ description: "x".repeat(2001) }).line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /description must be at most 2000 characters/);
});

test("AC4 — unsafe description markup is rejected safely", () => {
  for (const description of ["<script>alert(1)</script>", "See https://unsafe.example/listing"]) {
    const { repository } = setup();
    const result = run(repository, csv([csvRow({ description }).line]));
    assert.equal(result.invalid, 1, description);
    assert.equal(repository.findById("unit-import-001"), null, description);
  }
});

test("AC6 — invalid bathroom count is rejected", () => {
  for (const bathrooms of ["0", "1.5", "two"]) {
    const { repository } = setup();
    const result = run(repository, csv([csvRow({ bathrooms }).line]));
    assert.equal(result.invalid, 1, bathrooms);
    assert.match(result.errors[0]?.message ?? "", /bathrooms/);
  }
});

test("AC5 — importing more than 12 photos is rejected", () => {
  const { repository } = setup();
  const urls = Array.from({ length: 13 }, (_, index) => `https://images.example/${index}.jpg`).join("|");
  const result = run(repository, csv([csvRow({ photo_urls: urls }).line]));
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /at most 12 photo URLs/);
});

test("AC6/AC7/AC8 — HTTP, malformed, localhost, and internal photo URLs are rejected", () => {
  for (const photoUrl of [
    "http://images.example/photo.jpg",
    "not-a-url",
    "https://localhost/photo.jpg",
    "https://127.0.0.1/photo.jpg",
    "https://10.0.0.4/photo.jpg",
  ]) {
    const { repository } = setup();
    const result = run(repository, csv([csvRow({ photo_urls: photoUrl }).line]));
    assert.equal(result.invalid, 1, photoUrl);
    assert.equal(repository.findById("unit-import-001"), null, photoUrl);
  }
});

test("AC9 — dry-run validates photos without fetching or writing them", () => {
  const { repository } = setup();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("photo import must not fetch remote images"); }) as typeof fetch;
  try {
    const result = run(repository, csv([csvRow({ photo_urls: "https://images.example/photo.jpg" }).line]), { dryRun: true });
    assert.equal(result.valid, 1);
    assert.equal(result.imported, 0);
    assert.equal(repository.findById("unit-import-001"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AC10 — re-importing unchanged photos is idempotent", () => {
  const { repository } = setup();
  const contents = csv([csvRow({ photo_urls: "https://images.example/photo.jpg" }).line]);
  assert.equal(run(repository, contents).inserted, 1);
  const second = run(repository, contents);
  assert.equal(second.unchanged, 1);
  assert.equal(second.imported, 0);
});

test("AC9 — re-importing unchanged description and bathroom values is idempotent", () => {
  const { repository } = setup();
  const contents = csv([csvRow().line]);
  assert.equal(run(repository, contents).inserted, 1);
  const second = run(repository, contents);
  assert.equal(second.unchanged, 1);
  assert.equal(second.imported, 0);
});

test("AC10/AC11 — re-import updates description and bathroom count", () => {
  const { repository } = setup();
  run(repository, csv([csvRow().line]));
  const result = run(repository, csv([csvRow({ description: "Updated listing copy.", bathrooms: "3" }).line]));
  assert.equal(result.updated, 1);
  assert.equal(repository.findById("unit-import-001")?.description, "Updated listing copy.");
  assert.equal(repository.findById("unit-import-001")?.bathrooms, 3);
});

test("AC11 — re-import can add, remove, and reorder photos", () => {
  const { repository } = setup();
  run(repository, csv([csvRow({ photo_urls: "https://images.example/a.jpg|https://images.example/b.jpg" }).line]));
  run(repository, csv([csvRow({ photo_urls: "https://images.example/b.jpg|https://images.example/c.jpg" }).line]));
  assert.deepEqual(repository.findById("unit-import-001")?.photoUrls, [
    "https://images.example/b.jpg",
    "https://images.example/c.jpg",
  ]);
});

test("AC12 — imported photos survive a JSON repository restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-photo-restart-"));
  const file = join(directory, "units.json");
  try {
    const first = new JsonUnitRepository(file);
    anchor(first as unknown as UnitRepository);
    run(first as unknown as UnitRepository, csv([csvRow({ photo_urls: "https://images.example/restart.jpg" }).line]));
    const restarted = new JsonUnitRepository(file);
    assert.deepEqual(restarted.findById("unit-import-001")?.photoUrls, ["https://images.example/restart.jpg"]);
    assert.equal(restarted.findById("unit-import-001")?.description, "A bright entire-place apartment with a quiet living room and reliable power.");
    assert.equal(restarted.findById("unit-import-001")?.bathrooms, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC7/AC8 — description and bathroom count survive a JSON repository restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-details-restart-"));
  const file = join(directory, "units.json");
  try {
    const first = new JsonUnitRepository(file);
    anchor(first as unknown as UnitRepository);
    run(first as unknown as UnitRepository, csv([csvRow().line]));
    const restarted = new JsonUnitRepository(file);
    assert.equal(restarted.findById("unit-import-001")?.description, "A bright entire-place apartment with a quiet living room and reliable power.");
    assert.equal(restarted.findById("unit-import-001")?.bathrooms, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Legacy Units load with safe missing-detail defaults and remain incomplete", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-legacy-details-"));
  const file = join(directory, "units.json");
  try {
    await writeFile(file, JSON.stringify([{
      id: "legacy-unit",
      propertyId: "legacy-property",
      title: "Legacy Unit",
      location: { city: "Lagos", neighbourhood: "Ikeja" },
      occupancyModel: "entire-place",
      capacity: 2,
      amenities: [],
      photoUrls: [],
      published: true,
      price: { nightlyKobo: 1, refundableSecurityDepositKobo: 0, version: "legacy" },
      operator: {},
      inspection: null,
      managementAuthority: null,
      regulatory: null,
      blockedDates: [],
    }]));
    const legacy = new JsonUnitRepository(file).findById("legacy-unit");
    assert.equal(legacy?.description, "");
    assert.equal(legacy?.bathrooms, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC9 — duplicate photo URLs are reported by dry-run", () => {
  const { repository } = setup();
  const result = run(repository, csv([csvRow({ photo_urls: "https://images.example/a.jpg|https://images.example/a.jpg" }).line]), { dryRun: true });
  assert.equal(result.invalid, 1);
  assert.match(result.errors[0]?.message ?? "", /duplicate photo URL/);
});

test("AC16 — imported data survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-inventory-"));
  try {
    const file = join(directory, "inventory.json");
    const first = new JsonUnitRepository(file);
    anchor(first as unknown as UnitRepository);
    run(first as unknown as UnitRepository, csv([csvRow().line]));
    const restarted = new JsonUnitRepository(file);
    assert.equal(restarted.findById("unit-import-001")?.title, "Bright apartment in Ikeja");
    publishUnit(restarted as unknown as UnitRepository, "unit-import-001", { clock: () => NOW });
    const guest = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite"), inventoryPath: file, initialGuestPhoneNumber: null, initialGuestContactEmail: null });
    try {
      assert.deepEqual(guest.discoveryQuery.search({ location: "Lagos" }).facts.results.map((unit: { id: string }) => unit.id), ["unit-import-001"]);
    } finally {
      guest.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC17 — production inventory does not depend on fixture seeding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-inventory-empty-"));
  try {
    const file = join(directory, "inventory.json");
    const repository = new JsonUnitRepository(file);
    assert.deepEqual(repository.findAll(), []);
    anchor(repository as unknown as UnitRepository);
    run(repository as unknown as UnitRepository, csv([csvRow().line]));
    assert.equal((new JsonUnitRepository(file)).findById("unit-import-001")?.id, "unit-import-001");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC18 — the example template imports successfully in dry-run mode", async () => {
  const repository = new UnitRepository();
  anchor(repository, { operator: { ...operator(), id: "operator-existing-001" } });
  const template = await readFile("docs/pilot-inventory-template.csv", "utf8");
  const result = run(repository, template, { dryRun: true });
  assert.equal(result.valid, 2);
  assert.equal(result.rowsRead, 2);
  assert.equal(result.invalid, 0);
  assert.equal(result.imported, 0);
});

test("100 synthetic Units complete a dry-run and import", () => {
  const { repository } = setup();
  const first = csvRow();
  const lines = Array.from({ length: 100 }, (_, index) => {
    const row = csvRow({
      unit_id: `unit-synthetic-${String(index + 1).padStart(3, "0")}`,
      property_id: `property-synthetic-${String(index + 1).padStart(3, "0")}`,
      external_listing_id: `synthetic-${String(index + 1).padStart(3, "0")}`,
      city: index % 2 === 0 ? "Lagos" : "Abuja",
    });
    return row.line;
  });
  const contents = [first.headers.join(","), ...lines].join("\n");
  const dryRun = run(repository, contents, { dryRun: true });
  assert.equal(dryRun.valid, 100);
  assert.equal(dryRun.invalid, 0);
  const imported = run(repository, contents);
  assert.equal(imported.inserted, 100);
  assert.equal(repository.findAll().filter((unit) => unit.id.startsWith("unit-synthetic-")).length, 100);
});

test("inventory audit events contain no regulatory evidence", () => {
  const { repository, audit } = setup();
  const result = run(repository, csv([csvRow().line]), { audit });
  assert.equal(result.inserted, 1);
  assert.match(JSON.stringify(audit.entries), /unit.imported/);
  assert.doesNotMatch(JSON.stringify(audit.entries), /inspection_scope|insurance_public|evidence/i);
});

test("publication attempts and blocks are audited without evidence payloads", () => {
  const { repository, audit } = setup();
  run(repository, csv([csvRow({ inspection_expiry: "" }).line]), { audit });
  assert.throws(() => publishUnit(repository, "unit-import-001", { clock: () => NOW, audit }), /inspection/i);
  assert.match(JSON.stringify(audit.entries), /unit.publication.attempted/);
  assert.match(JSON.stringify(audit.entries), /unit.publication.blocked/);
  assert.doesNotMatch(JSON.stringify(audit.entries), /inspection_scope|insurance_public|evidence/i);
});
