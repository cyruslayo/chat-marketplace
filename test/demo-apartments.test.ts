/**
 * Demo-launch issue 05 (ADR 0105 amended 22 Oct 2026; ADR 0092; ADR 0089; ADR 0095; ADR 0075).
 * The synthetic demo inventory is loaded through the real inventory importer, quoted through the real quote path,
 * and checked against the photo files and credits on disk. No value here is a real person, building or operator.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isEligibleUnit, JsonUnitRepository, UnitDiscoveryQuery, UnitRepository } from "../domains/shortlet/src/browse.js";
import { importInventoryCsv, operatorResolverFromRepository } from "../domains/shortlet/src/inventory-import.js";
import { publishUnit } from "../domains/shortlet/src/onboarding.js";
import { createStayQuote } from "../domains/shortlet/src/quote.js";
import { DEMO_EXTENDED_STAY_POLICY } from "../domains/shortlet/src/extended-stay.js";
import { guestPriceFromOwnerTerms, unitOwnerTerms } from "../domains/shortlet/src/owner-terms.js";
import { demoInventoryLines, demoOperatorRecords, substituteDemoOrigin } from "../scripts/demo-provision.js";

const demoDirectory = join(process.cwd(), "apps/cloudflare/demo");
const photosDirectory = join(process.cwd(), "apps/cloudflare/public/demo/photos");
const placeholderOrigin = "https://demo-origin.invalid";
const publicOrigin = "https://demo.example.test";
const operatorId = "demo-operator-001";
const tenantId = "tenant-staging";
const now = new Date("2026-10-22T12:00:00.000Z");
const CHECK_IN = "2026-11-02";
const EXPECTED_NEIGHBOURHOODS = ["Old Ikoyi", "Lekki Phase 1", "Victoria Island", "Yaba", "Ikeja GRA", "Banana Island", "Wuse 2", "Maitama"];

function readCsv(name: string): string {
  return readFileSync(join(demoDirectory, name), "utf8");
}

/** The CSV as the provisioner sends it: the placeholder origin replaced by a public HTTPS origin, never a real host. */
function inventoryWithPublicOrigin(): string {
  return readCsv("inventory.csv").replaceAll(placeholderOrigin, publicOrigin);
}

function demoOperatorRecord() {
  const [record] = demoOperatorRecords(readCsv("operators.csv"));
  return record!.operator;
}

function operatorLookup() {
  return { findById: (id: string) => (id === operatorId ? demoOperatorRecord() : null) };
}

function importDemoInventory(csv = inventoryWithPublicOrigin()) {
  const repository = new UnitRepository();
  const result = importInventoryCsv(csv, {
    repository,
    operatorResolver: operatorResolverFromRepository(operatorLookup()),
    tenantId,
    clock: () => now,
  });
  return { result, repository };
}

function photoFiles(): string[] {
  return readdirSync(photosDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(join(photosDirectory, entry.name)).map((file) => `${entry.name}/${file}`))
    .filter((file) => file.endsWith(".jpg"))
    .sort();
}

test("AC1: all 8 demo units import cleanly, publish and pass isEligibleUnit", () => {
  const { result, repository } = importDemoInventory();
  assert.equal(result.rowsRead, 8);
  assert.equal(result.invalid, 0, JSON.stringify(result.errors));
  assert.equal(result.publicationReady, 8);
  assert.equal(result.inserted, 8);
  const units = repository.findAll();
  assert.equal(units.length, 8);
  assert.deepEqual([...new Set(units.map((unit) => unit.location.neighbourhood))].sort(), [...EXPECTED_NEIGHBOURHOODS].sort());
  assert.equal(units.filter((unit) => unit.location.city === "Lagos").length, 6);
  assert.equal(units.filter((unit) => unit.location.city === "Abuja").length, 2);
  assert.deepEqual(units.map((unit) => unit.bedrooms ?? 0).sort((a, b) => a - b), [0, 1, 1, 2, 2, 2, 3, 3]);
  for (const unit of units) {
    const published = publishUnit(repository, unit.id, { clock: () => now });
    assert.equal(isEligibleUnit(published, now), true, unit.id);
    assert.equal(published.extendedStay?.optedIn, true, `${unit.id} is opted in to Extended Stay`);
    assert.match(published.description, /^Demo listing\./, `${unit.id} is labelled as a demo listing`);
  }
});

test("AC1: every demo unit quotes valid Extended Stays from 30 to 180 nights, including a shorter final period", () => {
  const { repository } = importDemoInventory();
  for (const unit of repository.findAll()) {
    const published = publishUnit(repository, unit.id, { clock: () => now });
    const guest = guestPriceFromOwnerTerms(unitOwnerTerms(published));
    for (const nights of [30, 45, 61, 90, 120, 150, 179, 180]) {
      const checkOut = new Date(Date.parse(`${CHECK_IN}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10);
      const quote = createStayQuote({ unit: published, checkIn: CHECK_IN, checkOut, clock: () => now, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY });
      const periods = quote.billingPeriods ?? [];
      assert.equal(quote.stayType, "extended", `${unit.id} ${nights} nights`);
      assert.equal(quote.nights, nights);
      assert.equal(periods.length, Math.ceil(nights / 30), `${unit.id} ${nights} nights period count`);
      assert.equal(periods.reduce((total, period) => total + period.nights, 0), nights);
      assert.ok(periods.every((period) => period.amountKobo > 0), `${unit.id} ${nights} nights every period is payable`);
      const last = periods[periods.length - 1]!;
      if (nights % 30 !== 0) {
        assert.equal(last.nights, nights % 30, `${unit.id} ${nights} nights final period`);
        // ADR 0092: a shorter final period is priced night by night at the Short Stay guest nightly price (ADR 0089).
        assert.equal(last.amountKobo, guest.nightlyKobo * last.nights + guest.mandatoryFeesKobo, `${unit.id} ${nights} nights final period price`);
      }
    }
  }
});

test("AC1 failure path: the inventory importer rejects non-HTTPS and localhost photo URLs with a named reason", () => {
  const source = readCsv("inventory.csv");
  const firstPhoto = /https:\/\/demo-origin\.invalid\/demo\/photos\/[^|,"\r\n]+/;
  const expectations: Array<[string, RegExp]> = [
    ["http://demo.example.test/demo/photos/ikoyi/1.jpg", /must use HTTPS/],
    ["https://localhost/demo/photos/ikoyi/1.jpg", /must use a public HTTPS host/],
  ];
  for (const [badUrl, reason] of expectations) {
    const repository = new UnitRepository();
    const csv = source.replace(firstPhoto, badUrl).replaceAll(placeholderOrigin, publicOrigin);
    const result = importInventoryCsv(csv, {
      repository,
      operatorResolver: operatorResolverFromRepository(operatorLookup()),
      tenantId,
      clock: () => now,
    });
    assert.equal(result.invalid, 1, badUrl);
    assert.match(result.errors[0]!.message, reason, badUrl);
    assert.equal(repository.findAll().length, 7, `${badUrl}: only the 7 valid rows are stored`);
  }
});

test("AC1 local pilot check: the same CSVs import through the local pilot JSON repositories", () => {
  const directory = join(process.cwd(), ".scratch", "demo-apartments-local-check");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  try {
    const units = new JsonUnitRepository(join(directory, "inventory.json"));
    const result = importInventoryCsv(inventoryWithPublicOrigin(), {
      repository: units,
      operatorResolver: operatorResolverFromRepository(operatorLookup()),
      tenantId,
      clock: () => now,
    });
    assert.equal(result.invalid, 0, JSON.stringify(result.errors));
    assert.equal(result.inserted, 8);
    assert.equal(new JsonUnitRepository(join(directory, "inventory.json")).findAll().length, 8);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AC2: every demo unit has 4 to 5 photos, and every photo path exists under the static demo directory", () => {
  const { result, repository } = importDemoInventory();
  assert.equal(result.invalid, 0, JSON.stringify(result.errors));
  for (const unit of repository.findAll()) {
    assert.ok(unit.photoUrls.length >= 4 && unit.photoUrls.length <= 5, `${unit.id} has ${unit.photoUrls.length} photos`);
    for (const url of unit.photoUrls) {
      const pathname = new URL(url).pathname;
      assert.ok(pathname.startsWith("/demo/photos/"), url);
      const path = join(photosDirectory, pathname.replace(/^\/demo\/photos\//, ""));
      assert.ok(path.startsWith(photosDirectory), path);
      assert.equal(existsSync(path), true, path);
      assert.equal(statSync(path).isFile(), true, path);
      assert.ok(statSync(path).size <= 260 * 1024, `${path} is about 250KB or less`);
    }
  }
});

test("AC2: each demo photo is a JPEG resized to 1600 pixels wide", () => {
  for (const file of photoFiles()) {
    const bytes = readFileSync(join(photosDirectory, file));
    assert.equal(bytes[0], 0xff, file);
    assert.equal(bytes[1], 0xd8, file);
    let offset = 2;
    let width = 0;
    while (offset < bytes.length && width === 0) {
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) width = bytes.readUInt16BE(offset + 7);
      offset += 2 + length;
    }
    assert.equal(width, 1600, file);
  }
});

test("AC3: every demo photo file has exactly one credit line in CREDITS.md", () => {
  const creditLines = readFileSync(join(photosDirectory, "CREDITS.md"), "utf8").split(/\r?\n/);
  const files = photoFiles();
  assert.ok(files.length >= 32 && files.length <= 40, `about 36 photos, found ${files.length}`);
  for (const file of files) {
    const lines = creditLines.filter((line) => line.startsWith("|") && line.includes(`\`${file}\``));
    assert.equal(lines.length, 1, `${file} has one credit line`);
    assert.match(lines[0]!, /unsplash\.com\/photos\//, `${file} names its source page`);
    assert.match(lines[0]!, /Unsplash License/, `${file} names its licence`);
  }
});

test("AC6: discovery returns the 8 demo units with their photos and a monthly Extended Stay total", () => {
  const { repository } = importDemoInventory();
  for (const unit of repository.findAll()) publishUnit(repository, unit.id, { clock: () => now });
  const discovery = new UnitDiscoveryQuery({
    repository,
    audit: { record() {} },
    telemetry: { track() {} },
    clock: () => now,
    extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY,
  });
  const checkOut = new Date(Date.parse(`${CHECK_IN}T00:00:00Z`) + 180 * 86_400_000).toISOString().slice(0, 10);
  const results = discovery.search({ checkIn: CHECK_IN, checkOut, partySize: 1 }).facts.results as Array<{ id: string; photoUrls: string[]; price: { allInStayTotalKobo: number | null } }>;
  assert.equal(results.length, 8);
  for (const result of results) {
    assert.ok(result.photoUrls.length >= 4 && result.photoUrls.length <= 5, result.id);
    assert.ok((result.price.allInStayTotalKobo ?? 0) > 0, `${result.id} shows a monthly total`);
  }
});

test("AC5 scope: the demo CSVs hold no secret-like values, no quoted fields, and only the fake CAC marker", () => {
  for (const name of ["inventory.csv", "operators.csv"]) {
    const text = readCsv(name);
    assert.doesNotMatch(text, /sk_(live|test)_|OPS_SHARED_SECRET|CF_ACCESS/i, name);
    assert.doesNotMatch(text, /"/, `${name} has no quoted fields`);
  }
  assert.match(readCsv("operators.csv"), /RC-DEMO-0001/);
  assert.equal(substituteDemoOrigin("https://demo-origin.invalid/demo/photos/a/1.jpg", publicOrigin), "https://demo.example.test/demo/photos/a/1.jpg");
  assert.equal(demoInventoryLines(readCsv("inventory.csv")).length, 9, "one header line and eight unit rows");
});
