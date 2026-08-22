import test from "node:test";
import assert from "node:assert/strict";
import {
  UnitRepository,
  seedIssue01Units,
  onboardOperator,
  registerUnit,
  recordPhysicalInspection,
  grantManagementAuthority,
  recordLicensingAndInsurance,
  publishUnit,
  flagMaterialUnitChange,
  getUnitOnboardingStatus,
  REQUIRED_INSPECTION_SCOPE,
  REQUIRED_AUTHORITY_PERMISSIONS,
  latestPossibleCheckoutDate
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  return { repository };
}

test("publication succeeds when all operator, unit, authority, inspection, licensing, insurance, and settlement requirements pass", () => {
  const { repository } = setup();

  const operator = onboardOperator({
    id: "op-100",
    name: "Lagos Hospitality Ltd",
    legalForm: "private-company-limited-by-shares",
    cacVerified: true,
    responsiblePersonsVerified: true,
    responsiblePersons: [{ name: "Jane Doe", role: "Director" }],
    beneficialOwnersVerified: true,
    paymentProviderApproved: true,
    settlementAccountVerified: true,
    settlementIdentity: { bank: "GTBank", accountNumber: "0123456789" },
    approvedAt: "2026-01-01",
    approvalExpiresAt: "2027-12-31"
  });

  assert.equal(operator.responsiblePersons.length, 1);
  assert.equal(operator.settlementIdentity.bank, "GTBank");

  const unit = registerUnit(repository, {
    id: "unit-ikeja-100",
    propertyId: "prop-ikeja-100",
    operator,
    title: "Luxury 2BR in Ikeja GRA",
    location: { city: "Lagos", neighbourhood: "Ikeja GRA" },
    occupancyModel: "entire-place",
    capacity: 4,
    amenities: ["wifi", "generator"],
    price: { nightlyKobo: 9000000, mandatoryFeesKobo: 1000000, refundableSecurityDepositKobo: 5000000, version: "v1" }
  });

  grantManagementAuthority(repository, unit.id, {
    id: "auth-100",
    propertyId: "prop-ikeja-100",
    verifiedAt: "2026-01-05",
    expiresAt: "2027-12-31",
    permissions: REQUIRED_AUTHORITY_PERMISSIONS
  });

  recordPhysicalInspection(repository, {
    unitId: unit.id,
    inspectorId: "insp-77",
    status: "passed",
    inspectedAt: "2026-01-10",
    expiresAt: "2027-01-10",
    scopeItems: REQUIRED_INSPECTION_SCOPE
  });

  recordLicensingAndInsurance(repository, unit.id, {
    licensing: { status: "verified", verifiedAt: "2026-01-02", expiresAt: "2027-12-31" },
    insurance: {
      status: "verified",
      verifiedAt: "2026-01-02",
      expiresAt: "2027-12-31",
      publicLiabilityPerOccurrenceKobo: 1000000000,
      annualAggregateKobo: 2000000000,
      propertyCoverVerified: true
    }
  });

  const published = publishUnit(repository, unit.id, { clock: () => new Date("2026-07-22T00:00:00Z") });
  assert.equal(published.published, true);
});

test("publication fails if any eligibility requirement is missing or expired", () => {
  const { repository } = setup();
  seedIssue01Units(repository);

  assert.throws(
    () => publishUnit(repository, "unit-abuja-expired", { clock: () => new Date("2026-07-22T00:00:00Z") }),
    /Physical inspection expired or invalid/
  );
});

test("scheduled reinspection grants no provisional eligibility", () => {
  const { repository } = setup();
  seedIssue01Units(repository);

  recordPhysicalInspection(repository, {
    unitId: "unit-lagos-001",
    inspectorId: "insp-88",
    status: "scheduled",
    inspectedAt: "2026-07-22",
    expiresAt: "2027-07-22",
    scopeItems: REQUIRED_INSPECTION_SCOPE
  });

  assert.throws(
    () => publishUnit(repository, "unit-lagos-001", { clock: () => new Date("2026-07-22T00:00:00Z") }),
    /Physical inspection expired or invalid/
  );
});

test("material unit change invalidates eligibility until reinspected", () => {
  const { repository } = setup();
  seedIssue01Units(repository);

  flagMaterialUnitChange(repository, "unit-lagos-001");

  const updated = repository.findAll().find((u: any) => u.id === "unit-lagos-001");
  assert.equal(updated.published, false);
  assert.equal(updated.inspection.materialChangePending, true);

  assert.throws(
    () => publishUnit(repository, "unit-lagos-001", { clock: () => new Date("2026-07-22T00:00:00Z") }),
    /Material unit change pending/
  );
});

test("inspectors can record physical evidence across all required scope items", () => {
  const { repository } = setup();
  seedIssue01Units(repository);

  const inspection = recordPhysicalInspection(repository, {
    unitId: "unit-lagos-001",
    inspectorId: "insp-99",
    status: "passed",
    inspectedAt: "2026-07-20",
    expiresAt: "2027-07-20",
    scopeItems: REQUIRED_INSPECTION_SCOPE,
    evidenceNotes: "All 9 mandatory categories verified on-site."
  });

  assert.equal(inspection.status, "passed");
  assert.equal(inspection.scope.length, 9);
});

test("publication requires eligibility through the furthest sellable checkout", () => {
  const { repository } = setup();
  seedIssue01Units(repository);
  const publicationDate = new Date("2026-07-22T00:00:00Z");

  assert.equal(latestPossibleCheckoutDate(publicationDate), "2026-11-03");

  const unit = repository.findById("unit-lagos-001");
  repository.save({
    ...unit,
    inspection: { ...unit.inspection, expiresAt: "2026-08-01" }
  });

  assert.throws(
    () => publishUnit(repository, "unit-lagos-001", { clock: () => publicationDate }),
    /Physical inspection expired or invalid/
  );

  const boundaryUnit = repository.findById("unit-lagos-001");
  repository.save({
    ...boundaryUnit,
    published: true,
    inspection: { ...boundaryUnit.inspection, expiresAt: "2026-11-03" }
  });

  assert.equal(publishUnit(repository, "unit-lagos-001", { clock: () => publicationDate }).published, true);
});

test("operators and staff see actionable status without raw evidence exposure", () => {
  const { repository } = setup();
  seedIssue01Units(repository);

  const unit = repository.findAll().find((u: any) => u.id === "unit-lagos-001");
  const status: any = getUnitOnboardingStatus(unit);

  assert.equal(status.unitId, "unit-lagos-001");
  assert.equal(status.published, true);
  assert.equal(status.eligibleForPublication, true);
  assert.deepEqual(status.blockers, []);
  assert.equal(status.inspectionStatus, "passed");
  assert.equal(status.operatorStatus, "approved");

  assert.equal(status.rawCACDocuments, undefined);
  assert.equal(status.beneficialOwnerDetails, undefined);
});
