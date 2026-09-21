import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JsonOperatorRepository,
  UnitRepository,
  bootstrapOperatorsFromUnitRepository,
  createProvisionedOperator,
  importInventoryCsv,
  operatorResolverFromRepository,
  operatorResolverFromUnitRepository,
  onboardOperator,
  publishUnit,
  type OperatorRecord,
} from "../domains/shortlet/src/index.js";
import { SqliteOperatorRepresentativeGrantStore, SqliteOperatorSessionAuthority } from "../domains/shortlet/src/index.js";
import { runOperatorCreateCommand, runOperatorListCommand, runOperatorUpdateCommand } from "../apps/shortlet-ops/src/operator-cli.js";

const NOW = new Date("2026-09-21T10:00:00.000Z");

function row(overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    external_listing_id: "synthetic-listing-001",
    unit_id: "synthetic-unit-001",
    property_id: "synthetic-property-001",
    operator_id: "operator-provisioned-001",
    title: "Synthetic eligible Abuja apartment",
    description: "A practical entire-place apartment in Wuse 2 with reliable power.",
    city: "Abuja",
    neighbourhood: "Wuse 2",
    capacity: "4",
    bedrooms: "2",
    bathrooms: "2",
    nightly_price_ngn: "120000",
    mandatory_fees_ngn: "10000",
    refundable_security_deposit_ngn: "20000",
    currency: "NGN",
    amenities: "wifi|parking",
    blocked_dates: "",
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
  return [headers.join(","), headers.map((header) => JSON.stringify(values[header] ?? "")).join(",")].join("\n");
}

function eligibleOperator(now = NOW): OperatorRecord {
  return {
    ...onboardOperator({
      id: "operator-provisioned-001",
      name: "Example Shortlets",
      legalForm: "private-company-limited-by-shares",
      cacVerified: true,
      responsiblePersonsVerified: true,
      beneficialOwnersVerified: true,
      paymentProviderApproved: true,
      settlementAccountVerified: true,
      status: "approved",
      approvedAt: "2026-01-01T00:00:00.000Z",
      approvalExpiresAt: "2027-12-31T23:59:59.000Z",
    }),
    tenantId: "tenant-abuja",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function directory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test("AC1 — A valid Operator can be provisioned durably.", async () => {
  const dir = await directory("operator-provisioning-");
  try {
    const repository = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    const result = runOperatorCreateCommand(repository, ["--operator-id", "operator-provisioned-001", "--tenant-id", "tenant-abuja", "--name", "Example Shortlets"]);
    assert.equal(result.operator.id, "operator-provisioned-001");
    assert.equal(repository.findById("operator-provisioned-001")?.name, "Example Shortlets");
    assert.equal(repository.findById("operator-provisioned-001")?.status, "unverified");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC2 — Duplicate Operator ID is rejected.", async () => {
  const dir = await directory("operator-duplicate-");
  try {
    const repository = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    runOperatorCreateCommand(repository, ["--operator-id", "operator-provisioned-001", "--tenant-id", "tenant-abuja", "--name", "Example Shortlets"]);
    assert.throws(() => runOperatorCreateCommand(repository, ["--operator-id", "operator-provisioned-001", "--tenant-id", "tenant-abuja", "--name", "Example Shortlets"]), /duplicate|already exists|conflict/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC3 — Provisioned Operator survives restart.", async () => {
  const dir = await directory("operator-restart-");
  try {
    const file = join(dir, "operators.json");
    new JsonOperatorRepository(file, { clock: () => NOW }).create(createProvisionedOperator({ id: "operator-provisioned-001", tenantId: "tenant-abuja", name: "Example Shortlets", now: NOW }));
    assert.equal(new JsonOperatorRepository(file).findById("operator-provisioned-001")?.tenantId, "tenant-abuja");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC4 — Operator list shows provisioned Operator.", async () => {
  const dir = await directory("operator-list-");
  try {
    const repository = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    runOperatorCreateCommand(repository, ["--operator-id", "operator-provisioned-001", "--tenant-id", "tenant-abuja", "--name", "Example Shortlets"]);
    const result = runOperatorListCommand(repository);
    assert.deepEqual(result.operators.map((operator) => operator.id), ["operator-provisioned-001"]);
    assert.equal(result.operators[0]?.name, "Example Shortlets");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC5 — Creating an Operator does not create representative authority.", async () => {
  const dir = await directory("operator-grant-separation-");
  const grantStore = new SqliteOperatorRepresentativeGrantStore(join(dir, "authority.sqlite"));
  try {
    const repository = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    runOperatorCreateCommand(repository, ["--operator-id", "operator-provisioned-001", "--tenant-id", "tenant-abuja", "--name", "Example Shortlets"]);
    assert.deepEqual(grantStore.listGrants(), []);
  } finally {
    grantStore.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC6 — Creating an Operator does not create an authenticated session.", async () => {
  const dir = await directory("operator-session-separation-");
  const authority = new SqliteOperatorSessionAuthority(join(dir, "auth.sqlite"));
  try {
    const repository = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    runOperatorCreateCommand(repository, ["--operator-id", "operator-provisioned-001", "--tenant-id", "tenant-abuja", "--name", "Example Shortlets"]);
    assert.deepEqual(authority.inspect(), { tokens: [], sessions: [] });
  } finally {
    authority.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC7 — Inventory import resolves a provisioned Operator.", async () => {
  const dir = await directory("operator-import-");
  try {
    const operators = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    operators.create(eligibleOperator());
    const units = new UnitRepository();
    const result = importInventoryCsv(row(), { repository: units, operatorResolver: operatorResolverFromRepository(operators), tenantId: "tenant-abuja", clock: () => NOW });
    assert.equal(result.inserted, 1);
    assert.equal(units.findById("synthetic-unit-001")?.operator.id, "operator-provisioned-001");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC8 — Inventory import rejects an unknown Operator.", async () => {
  const dir = await directory("operator-unknown-");
  try {
    const operators = new JsonOperatorRepository(join(dir, "operators.json"));
    const result = importInventoryCsv(row(), { repository: new UnitRepository(), operatorResolver: operatorResolverFromRepository(operators), tenantId: "tenant-abuja", clock: () => NOW });
    assert.equal(result.invalid, 1);
    assert.match(result.errors[0]?.message ?? "", /Operator.*not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC9 — Cross-tenant Operator references fail closed.", async () => {
  const dir = await directory("operator-tenant-");
  try {
    const operators = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    operators.create({ ...eligibleOperator(), tenantId: "tenant-lagos" });
    const result = importInventoryCsv(row(), { repository: new UnitRepository(), operatorResolver: operatorResolverFromRepository(operators), tenantId: "tenant-abuja", clock: () => NOW });
    assert.equal(result.invalid, 1);
    assert.match(result.errors[0]?.message ?? "", /tenant|not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC10 — Existing fixture-based tests continue to work.", () => {
  const repository = new UnitRepository();
  repository.save({ id: "fixture-unit", propertyId: "fixture-property", title: "Fixture", location: { city: "Lagos", neighbourhood: "Ikeja" }, occupancyModel: "entire-place", capacity: 1, amenities: [], published: false, price: { nightlyKobo: 1, refundableSecurityDepositKobo: 0, version: "fixture" }, operator: onboardOperator({ id: "fixture-operator", name: "Fixture Operator" }), inspection: null, managementAuthority: null, regulatory: null, blockedDates: [] });
  assert.equal(operatorResolverFromUnitRepository(repository).findById("fixture-operator")?.id, "fixture-operator");
});

test("AC11 — Production inventory does not require fixture Operators.", async () => {
  const dir = await directory("operator-no-fixture-");
  try {
    const operators = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    operators.create(createProvisionedOperator({ id: "operator-provisioned-001", tenantId: "tenant-abuja", name: "Example Shortlets", now: NOW }));
    const units = new UnitRepository();
    const result = importInventoryCsv(row(), { repository: units, operatorResolver: operatorResolverFromRepository(operators), tenantId: "tenant-abuja", clock: () => NOW });
    assert.equal(result.inserted, 1);
    assert.equal(units.findAll().length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AC12 — A fresh pilot environment can provision an Operator and import its first Unit without manual persistence edits.", async () => {
  const dir = await directory("operator-fresh-proof-");
  try {
    const operators = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    operators.create(eligibleOperator());
    const units = new UnitRepository();
    const imported = importInventoryCsv(row(), { repository: units, operatorResolver: operatorResolverFromRepository(operators), tenantId: "tenant-abuja", clock: () => NOW });
    assert.equal(imported.publicationReady, 1);
    publishUnit(units, "synthetic-unit-001", { clock: () => NOW });
    assert.equal(units.findById("synthetic-unit-001")?.published, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Operator display name can be updated without changing authority metadata.", async () => {
  const dir = await directory("operator-update-");
  try {
    const repository = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    const original = repository.create(createProvisionedOperator({ id: "operator-provisioned-001", tenantId: "tenant-abuja", name: "Old Name", now: NOW }));
    const updated = runOperatorUpdateCommand(repository, ["--operator-id", original.id, "--name", "New Name"]);
    assert.equal(updated.operator.name, "New Name");
    assert.equal(updated.operator.tenantId, "tenant-abuja");
    assert.equal(updated.operator.status, "unverified");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Existing inventory Operators can be explicitly bootstrapped without duplicating identities.", async () => {
  const dir = await directory("operator-bootstrap-");
  try {
    const units = new UnitRepository();
    units.save({ id: "legacy-unit", propertyId: "legacy-property", title: "Legacy", location: { city: "Lagos", neighbourhood: "Ikeja" }, occupancyModel: "entire-place", capacity: 1, amenities: [], published: false, price: { nightlyKobo: 1, refundableSecurityDepositKobo: 0, version: "legacy" }, operator: eligibleOperator(), inspection: null, managementAuthority: null, regulatory: null, blockedDates: [] });
    const operators = new JsonOperatorRepository(join(dir, "operators.json"), { clock: () => NOW });
    assert.equal(bootstrapOperatorsFromUnitRepository({ units, operators, tenantId: "tenant-abuja", now: NOW }).length, 1);
    assert.equal(bootstrapOperatorsFromUnitRepository({ units, operators, tenantId: "tenant-abuja", now: NOW }).length, 0);
    assert.equal(operators.findAll().length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
