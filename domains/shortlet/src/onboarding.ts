import { isEligibleUnit, latestPossibleCheckoutDate } from "./browse.js";

export const REQUIRED_AUTHORITY_PERMISSIONS: readonly string[] = Object.freeze([
  "advertise", "accept-bookings", "contract-guests", "provide-access",
  "collect-revenue", "manage-cancellations", "issue-refunds", "manage-incidents"
]);

export const REQUIRED_INSPECTION_SCOPE: readonly string[] = Object.freeze([
  "entire-place-possession", "structure-and-sanitation", "fire-and-emergency-readiness",
  "electrical-and-utilities", "locks-and-privacy", "access-controls", "cameras",
  "listing-accuracy", "current-media"
]);

function findUnitOrThrow(repository: any, unitId: string): any {
  const units = repository.findAll();
  const unit = units.find((u: any) => u.id === unitId);
  if (!unit) throw new Error(`Unit ${unitId} not found`);
  return unit;
}

export interface OnboardOperatorOptions {
  id: string;
  name: string;
  legalForm?: string | null;
  cacVerified?: boolean;
  responsiblePersonsVerified?: boolean;
  responsiblePersons?: any[];
  beneficialOwnersVerified?: boolean;
  paymentProviderApproved?: boolean;
  settlementAccountVerified?: boolean;
  settlementIdentity?: any;
  status?: string;
  approvedAt?: string;
  approvalExpiresAt?: string;
}

export function onboardOperator({
  id,
  name,
  legalForm = null,
  cacVerified = true,
  responsiblePersonsVerified = true,
  responsiblePersons = [],
  beneficialOwnersVerified = true,
  paymentProviderApproved = true,
  settlementAccountVerified = true,
  settlementIdentity = null,
  status = "approved",
  approvedAt = new Date().toISOString(),
  approvalExpiresAt
}: OnboardOperatorOptions) {
  return Object.freeze({
    id,
    name,
    legalForm,
    cacVerified,
    responsiblePersonsVerified,
    responsiblePersons: Array.isArray(responsiblePersons) ? [...responsiblePersons] : responsiblePersons,
    beneficialOwnersVerified,
    paymentProviderApproved,
    settlementAccountVerified,
    settlementIdentity: settlementIdentity ? { ...settlementIdentity } : null,
    status,
    approvedAt,
    approvalExpiresAt
  });
}

export interface RegisterUnitOptions {
  id: string;
  propertyId: string;
  operator: any;
  title: string;
  location: any;
  occupancyModel?: string;
  capacity: number;
  amenities?: string[];
  price: any;
  blockedDates?: any[];
}

export function registerUnit(repository: any, {
  id,
  propertyId,
  operator,
  title,
  location,
  occupancyModel = "entire-place",
  capacity,
  amenities = [],
  price,
  blockedDates = []
}: RegisterUnitOptions) {
  const unit = {
    id,
    propertyId,
    operator,
    title,
    location,
    occupancyModel,
    capacity,
    amenities,
    price,
    published: false,
    inspection: null,
    managementAuthority: null,
    regulatory: null,
    blockedDates
  };
  repository.save(unit);
  return structuredClone(unit);
}

export interface GrantManagementAuthorityOptions {
  id: string;
  propertyId?: string;
  status?: string;
  verifiedAt?: string;
  expiresAt?: string;
  permissions?: readonly string[];
}

export function grantManagementAuthority(repository: any, unitId: string, {
  id,
  propertyId,
  status = "verified",
  verifiedAt = new Date().toISOString(),
  expiresAt,
  permissions = REQUIRED_AUTHORITY_PERMISSIONS
}: GrantManagementAuthorityOptions) {
  const unit = findUnitOrThrow(repository, unitId);

  unit.managementAuthority = {
    id,
    propertyId: propertyId ?? unit.propertyId,
    status,
    verifiedAt,
    expiresAt,
    permissions: [...permissions]
  };
  repository.save(unit);
  return structuredClone(unit.managementAuthority);
}

export interface RecordPhysicalInspectionOptions {
  unitId: string;
  inspectorId: string;
  status?: string;
  inspectedAt?: string;
  expiresAt?: string;
  scopeItems?: readonly string[];
  evidenceNotes?: string;
}

export function recordPhysicalInspection(repository: any, {
  unitId,
  inspectorId,
  status = "passed",
  inspectedAt = new Date().toISOString(),
  expiresAt,
  scopeItems = REQUIRED_INSPECTION_SCOPE,
  evidenceNotes
}: RecordPhysicalInspectionOptions) {
  const unit = findUnitOrThrow(repository, unitId);

  unit.inspection = {
    id: `inspection-${crypto.randomUUID()}`,
    inspectorId,
    status,
    inspectedAt,
    expiresAt,
    materialChangePending: false,
    scope: [...scopeItems],
    evidenceNotes
  };

  if (status !== "passed") {
    unit.published = false;
  }

  repository.save(unit);
  return structuredClone(unit.inspection);
}

export function recordLicensingAndInsurance(repository: any, unitId: string, { licensing, insurance }: { licensing: any; insurance: any }) {
  const unit = findUnitOrThrow(repository, unitId);

  unit.regulatory = {
    licensing: structuredClone(licensing),
    insurance: structuredClone(insurance)
  };

  repository.save(unit);
  return structuredClone(unit.regulatory);
}

export function flagMaterialUnitChange(repository: any, unitId: string) {
  const unit = findUnitOrThrow(repository, unitId);

  if (unit.inspection) {
    unit.inspection.materialChangePending = true;
  }
  unit.published = false;
  repository.save(unit);
  return structuredClone(unit);
}

export function publishUnit(repository: any, unitId: string, { clock = () => new Date() }: { clock?: () => Date } = {}) {
  const unit = findUnitOrThrow(repository, unitId);

  const now = clock();
  const status = getUnitOnboardingStatus(unit, now);

  if (!status.eligibleForPublication) {
    unit.published = false;
    repository.save(unit);
    throw new Error(`Unit publication failed: ${status.blockers.join("; ")}`);
  }

  unit.published = true;
  repository.save(unit);
  return structuredClone(unit);
}

export function getUnitOnboardingStatus(unit: any, now: Date | string = new Date()) {
  const nowDate = typeof now === "string" ? new Date(now) : (now instanceof Date ? now : new Date());
  const today = typeof now === "string" ? now : nowDate.toISOString().slice(0, 10);
  const latestCheckout = latestPossibleCheckoutDate(nowDate);
  const blockers: string[] = [];

  if (!unit.operator || unit.operator.status !== "approved") {
    blockers.push("Operator not approved");
  }
  if (unit.operator?.approvalExpiresAt && unit.operator.approvalExpiresAt < latestCheckout) {
    blockers.push("Operator approval expired");
  }
  if (!unit.operator?.cacVerified || !unit.operator?.responsiblePersonsVerified || !unit.operator?.beneficialOwnersVerified) {
    blockers.push("Operator verification incomplete");
  }
  if (!unit.operator?.paymentProviderApproved || !unit.operator?.settlementAccountVerified) {
    blockers.push("Operator settlement/payment provider not verified");
  }

  if (!unit.inspection || unit.inspection.status !== "passed" || (unit.inspection.expiresAt && unit.inspection.expiresAt < latestCheckout)) {
    blockers.push("Physical inspection expired or invalid");
  }
  if (unit.inspection?.materialChangePending) {
    blockers.push("Material unit change pending reinspection");
  }
  if (unit.inspection && REQUIRED_INSPECTION_SCOPE.some((item) => !unit.inspection.scope?.includes(item))) {
    blockers.push("Physical inspection scope incomplete");
  }

  if (!unit.managementAuthority || unit.managementAuthority.status !== "verified" || (unit.managementAuthority.expiresAt && unit.managementAuthority.expiresAt < latestCheckout)) {
    blockers.push("Management authority missing, invalid or expired");
  }
  if (unit.managementAuthority && REQUIRED_AUTHORITY_PERMISSIONS.some((p) => !unit.managementAuthority.permissions?.includes(p))) {
    blockers.push("Management authority permissions incomplete");
  }

  if (!unit.regulatory?.licensing || unit.regulatory.licensing.status !== "verified" || (unit.regulatory.licensing.expiresAt && unit.regulatory.licensing.expiresAt < latestCheckout)) {
    blockers.push("Licensing missing, invalid or expired");
  }

  if (!unit.regulatory?.insurance || unit.regulatory.insurance.status !== "verified" || (unit.regulatory.insurance.expiresAt && unit.regulatory.insurance.expiresAt < latestCheckout)) {
    blockers.push("Insurance missing, invalid or expired");
  }
  if (unit.regulatory?.insurance?.publicLiabilityPerOccurrenceKobo != null && unit.regulatory.insurance.publicLiabilityPerOccurrenceKobo < 1000000000) {
    blockers.push("Insurance public liability per occurrence below 1,000,000,000 NGN kobo");
  }
  if (unit.regulatory?.insurance?.annualAggregateKobo != null && unit.regulatory.insurance.annualAggregateKobo < 2000000000) {
    blockers.push("Insurance annual aggregate below 2,000,000,000 NGN kobo");
  }

  const tempUnit = { ...unit, published: true };
  if (!isEligibleUnit(tempUnit, nowDate, { checkOut: latestCheckout })) {
    if (blockers.length === 0) blockers.push("Unit eligibility requirements not met through checkout");
  }

  const eligibleForPublication = blockers.length === 0;

  return Object.freeze({
    unitId: unit.id,
    published: unit.published === true,
    eligibleForPublication,
    blockers,
    operatorStatus: unit.operator?.status ?? "unverified",
    inspectionStatus: unit.inspection?.status ?? "uninspected",
    authorityStatus: unit.managementAuthority?.status ?? "unverified",
    licensingStatus: unit.regulatory?.licensing?.status ?? "unverified",
    insuranceStatus: unit.regulatory?.insurance?.status ?? "unverified"
  });
}
