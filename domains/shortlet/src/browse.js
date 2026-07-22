import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LAGOS_TIME_ZONE = "Africa/Lagos";
const SUPPORTED_LOCATIONS = new Set(["Lagos", "Abuja"]);
const MAX_STAY_NIGHTS = 14;
const BOOKING_HORIZON_DAYS = 90;
const AUTHORITY_PERMISSIONS = [
  "advertise", "accept-bookings", "contract-guests", "provide-access",
  "collect-revenue", "manage-cancellations", "issue-refunds", "manage-incidents"
];
const INSPECTION_SCOPE = [
  "entire-place-possession", "structure-and-sanitation", "fire-and-emergency-readiness",
  "electrical-and-utilities", "locks-and-privacy", "access-controls", "cameras",
  "listing-accuracy", "current-media"
];

function asDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date`);
  return date;
}

function dateKeyInLagos(value, field) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : asDate(value, field);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((candidate) => candidate.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDayNumber(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export class StayDateRange {
  constructor(checkIn, checkOut, now = new Date()) {
    this.checkIn = dateKeyInLagos(checkIn, "checkIn");
    this.checkOut = dateKeyInLagos(checkOut, "checkOut");
    this.nights = calendarDayNumber(this.checkOut) - calendarDayNumber(this.checkIn);
    if (this.nights < 1) throw new RangeError("checkOut must be after checkIn");
    if (this.nights > MAX_STAY_NIGHTS) throw new RangeError(`stay cannot exceed ${MAX_STAY_NIGHTS} nights`);
    const today = dateKeyInLagos(now, "now");
    const horizonOffset = calendarDayNumber(this.checkIn) - calendarDayNumber(today);
    if (horizonOffset < 0 || horizonOffset > BOOKING_HORIZON_DAYS) {
      throw new RangeError(`check-in must be within the ${BOOKING_HORIZON_DAYS}-day booking horizon`);
    }
    Object.freeze(this);
  }

  overlaps(range) {
    return this.checkIn < dateKeyInLagos(range.end, "blockedDates.end")
      && dateKeyInLagos(range.start, "blockedDates.start") < this.checkOut;
  }
}

function claimCoversCheckout(claim, today, checkout, acceptedStatus = "verified") {
  return claim?.status === acceptedStatus
    && dateKeyInLagos(claim.verifiedAt, "claim.verifiedAt") <= today
    && dateKeyInLagos(claim.expiresAt, "claim.expiresAt") >= checkout;
}

function authorityCoversCheckout(authority, propertyId, today, checkout) {
  return claimCoversCheckout(authority, today, checkout)
    && authority.propertyId === propertyId
    && AUTHORITY_PERMISSIONS.every((permission) => authority.permissions?.includes(permission));
}

function operatorIsEligible(operator, today, checkout) {
  return operator?.status === "approved"
    && ["business-name", "private-company-limited-by-shares"].includes(operator.legalForm)
    && operator.cacVerified === true
    && operator.responsiblePersonsVerified === true
    && operator.beneficialOwnersVerified === true
    && operator.paymentProviderApproved === true
    && operator.settlementAccountVerified === true
    && dateKeyInLagos(operator.approvedAt, "operator.approvedAt") <= today
    && dateKeyInLagos(operator.approvalExpiresAt, "operator.approvalExpiresAt") >= checkout;
}

export function isEligibleUnit(unit, now = new Date(), dateRange) {
  const today = dateKeyInLagos(now, "now");
  const checkout = dateRange?.checkOut ?? dateKeyInLagos(now, "now");
  return unit.published === true
    && unit.occupancyModel === "entire-place"
    && SUPPORTED_LOCATIONS.has(unit.location.city)
    && operatorIsEligible(unit.operator, today, checkout)
    && unit.inspection?.status === "passed"
    && unit.inspection.materialChangePending !== true
    && dateKeyInLagos(unit.inspection.inspectedAt, "inspection.inspectedAt") <= today
    && dateKeyInLagos(unit.inspection.expiresAt, "inspection.expiresAt") >= checkout
    && INSPECTION_SCOPE.every((item) => unit.inspection.scope?.includes(item))
    && authorityCoversCheckout(unit.managementAuthority, unit.propertyId, today, checkout)
    && claimCoversCheckout(unit.regulatory?.licensing, today, checkout)
    && claimCoversCheckout(unit.regulatory?.insurance, today, checkout)
    && unit.regulatory.insurance.publicLiabilityPerOccurrenceKobo >= 1000000000
    && unit.regulatory.insurance.annualAggregateKobo >= 2000000000
    && unit.regulatory.insurance.propertyCoverVerified === true;
}

export class UnitRepository {
  #units = new Map();
  save(unit) { this.#units.set(unit.id, structuredClone(unit)); }
  findAll() { return [...this.#units.values()].map((unit) => structuredClone(unit)); }
}

export class JsonUnitRepository {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    if (!readFileSafe(filePath)) writeFileSync(filePath, "[]", "utf8");
  }
  save(unit) {
    const units = this.findAll().filter((candidate) => candidate.id !== unit.id);
    writeFileSync(this.filePath, JSON.stringify([...units, unit], null, 2), "utf8");
  }
  findAll() { return JSON.parse(readFileSync(this.filePath, "utf8")).map((unit) => structuredClone(unit)); }
}

function readFileSafe(filePath) {
  try { return readFileSync(filePath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function allInStayTotalKobo(unit, dateRange) {
  if (!dateRange) return null;
  return unit.price.nightlyKobo * dateRange.nights + (unit.price.mandatoryFeesKobo ?? 0);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function toDiscoveryProjection(unit, dateRange) {
  const allInTotal = allInStayTotalKobo(unit, dateRange);
  return deepFreeze({
    id: unit.id, title: unit.title,
    location: { city: unit.location.city, neighbourhood: unit.location.neighbourhood },
    capacity: unit.capacity, amenities: [...unit.amenities],
    price: {
      nightlyKobo: unit.price.nightlyKobo,
      allInStayTotalKobo: allInTotal,
      mandatoryFeesKobo: unit.price.mandatoryFeesKobo ?? 0,
      refundableSecurityDepositKobo: unit.price.refundableSecurityDepositKobo,
      amountDueNowKobo: allInTotal === null ? null : allInTotal + unit.price.refundableSecurityDepositKobo,
      currency: "NGN", pricingVersion: unit.price.version
    },
    trust: {
      inspection: {
        status: "current", inspectedAt: unit.inspection.inspectedAt,
        expiresAt: unit.inspection.expiresAt, scope: [...unit.inspection.scope]
      },
      managementAuthority: { status: "current", verifiedAt: unit.managementAuthority.verifiedAt },
      occupancyModel: "entire-place"
    }
  });
}

function createInteractionArtifact({ id, filters, results }) {
  return deepFreeze({
    id, kind: "shortlet.discovery-results", schemaVersion: "shortlet.discovery/v1", projectionVersion: 1,
    domainReferences: results.map((unit) => ({ type: "Unit", id: unit.id })),
    policyVersions: { eligibility: "launch-2026-07", pricing: "all-in/v1" },
    disclosures: ["Rates without dates and party size are indicative; dated results show the All-In Stay Total."],
    facts: { filters: Object.freeze({ ...filters }), results: Object.freeze(results) },
    amounts: results.map((unit) => ({ unitId: unit.id, ...unit.price })),
    actions: results.map((unit) => ({ type: "view-unit", unitId: unit.id, conventionalRoute: `/stays/${unit.id}` })),
    acknowledgements: [], sensitivity: "public"
  });
}

export class UnitDiscoveryQuery {
  constructor({ repository, audit, telemetry, clock = () => new Date(), idFactory = () => crypto.randomUUID() }) {
    Object.assign(this, { repository, audit, telemetry, clock, idFactory });
  }

  search(filters = {}) {
    const now = this.clock();
    const hasAnyDate = filters.checkIn !== undefined || filters.checkOut !== undefined;
    if (hasAnyDate && (!filters.checkIn || !filters.checkOut)) throw new TypeError("checkIn and checkOut are required together");
    const dateRange = hasAnyDate ? new StayDateRange(filters.checkIn, filters.checkOut, now) : null;
    if (filters.partySize !== undefined && (!Number.isInteger(filters.partySize) || filters.partySize < 1)) {
      throw new RangeError("partySize must be a positive integer");
    }
    const hasPrice = filters.minPriceKobo !== undefined || filters.maxPriceKobo !== undefined;
    if (hasPrice && (!dateRange || filters.partySize === undefined)) {
      throw new TypeError("price filters require dates and partySize for an All-In Stay Total");
    }
    const results = this.repository.findAll()
      .filter((unit) => isEligibleUnit(unit, now, dateRange))
      .filter((unit) => !filters.location || unit.location.city === filters.location)
      .filter((unit) => !filters.amenity || unit.amenities.includes(filters.amenity))
      .filter((unit) => filters.partySize === undefined || unit.capacity >= filters.partySize)
      .filter((unit) => !dateRange || !unit.blockedDates.some((range) => dateRange.overlaps(range)))
      .filter((unit) => filters.minPriceKobo === undefined || allInStayTotalKobo(unit, dateRange) >= filters.minPriceKobo)
      .filter((unit) => filters.maxPriceKobo === undefined || allInStayTotalKobo(unit, dateRange) <= filters.maxPriceKobo)
      .map((unit) => toDiscoveryProjection(unit, dateRange));
    const queryId = `search-${this.idFactory()}`;
    const artifact = createInteractionArtifact({ id: queryId, filters, results });
    this.audit.record({ type: "unit.search", queryId, filters: { ...filters }, resultUnitIds: results.map((unit) => unit.id) });
    this.telemetry.track({ type: "unit.search.completed", queryId, resultCount: results.length });
    return artifact;
  }
}

export function seedIssue01Units(repository) {
  const eligible = {
    id: "unit-lagos-001", propertyId: "property-lagos-001",
    title: "Sunlit 2-bedroom apartment in Ikeja",
    location: { city: "Lagos", neighbourhood: "Ikeja" }, occupancyModel: "entire-place",
    capacity: 4, amenities: ["wifi", "generator", "parking"], published: true,
    price: { nightlyKobo: 8500000, mandatoryFeesKobo: 1000000, refundableSecurityDepositKobo: 5000000, version: "price-1" },
    operator: {
      id: "operator-001", status: "approved", approvedAt: "2026-01-10", legalForm: "private-company-limited-by-shares",
      cacVerified: true, responsiblePersonsVerified: true, beneficialOwnersVerified: true, paymentProviderApproved: true,
      settlementAccountVerified: true, approvalExpiresAt: "2027-03-01"
    },
    inspection: {
      id: "inspection-001", status: "passed", inspectedAt: "2026-01-15",
      expiresAt: "2027-01-15", materialChangePending: false, scope: INSPECTION_SCOPE
    },
    managementAuthority: {
      id: "authority-001", propertyId: "property-lagos-001", status: "verified",
      verifiedAt: "2026-02-01", expiresAt: "2027-02-01", permissions: AUTHORITY_PERMISSIONS
    },
    regulatory: {
      licensing: { status: "verified", verifiedAt: "2026-01-12", expiresAt: "2027-02-15" },
      insurance: {
        status: "verified", verifiedAt: "2026-01-12", expiresAt: "2027-02-15",
        publicLiabilityPerOccurrenceKobo: 1000000000,
        annualAggregateKobo: 2000000000,
        propertyCoverVerified: true
      }
    },
    blockedDates: []
  };
  repository.save(eligible);
  repository.save({
    ...eligible, id: "unit-abuja-expired", propertyId: "property-abuja-001",
    title: "Expired inspection unit", location: { city: "Abuja", neighbourhood: "Wuse" },
    inspection: { ...eligible.inspection, id: "inspection-expired", expiresAt: "2025-01-01" },
    managementAuthority: { ...eligible.managementAuthority, id: "authority-abuja", propertyId: "property-abuja-001" }
  });
}
