import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { calculateTaxKobo } from "./quote.js";

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

export interface BlockedDateRange {
  start: string | Date;
  end: string | Date;
}

export interface Unit {
  id: string;
  propertyId: string;
  title: string;
  location: { city: string; neighbourhood: string };
  occupancyModel: string;
  capacity: number;
  amenities: string[];
  published: boolean;
  price: {
    nightlyKobo: number;
    mandatoryFeesKobo?: number;
    refundableSecurityDepositKobo: number;
    version: string;
    taxConfig?: any;
  };
  operator: any;
  inspection: any;
  managementAuthority: any;
  regulatory: any;
  blockedDates: BlockedDateRange[];
  cancellationPolicy?: any;
  sameDayTurnover?: any;
}

function asDate(value: any, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date`);
  return date;
}

function dateKeyInLagos(value: any, field: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : asDate(value, field);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export type EligibilityThrough = Pick<StayDateRange, "checkOut">;

export function latestPossibleCheckoutDate(now: Date = new Date()): string {
  const today = dateKeyInLagos(now, "now");
  const latestCheckoutDay = calendarDayNumber(today) + BOOKING_HORIZON_DAYS + MAX_STAY_NIGHTS;
  return new Date(latestCheckoutDay * 86400000).toISOString().slice(0, 10);
}

export class StayDateRange {
  public readonly checkIn: string;
  public readonly checkOut: string;
  public readonly nights: number;

  constructor(checkIn: any, checkOut: any, now: Date = new Date()) {
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

  overlaps(range: { start: any; end: any }): boolean {
    return this.checkIn < dateKeyInLagos(range.end, "blockedDates.end")
      && dateKeyInLagos(range.start, "blockedDates.start") < this.checkOut;
  }
}

function claimCoversCheckout(claim: any, today: string, checkout: string, acceptedStatus = "verified"): boolean {
  return claim?.status === acceptedStatus
    && dateKeyInLagos(claim.verifiedAt, "claim.verifiedAt") <= today
    && dateKeyInLagos(claim.expiresAt, "claim.expiresAt") >= checkout;
}

function authorityCoversCheckout(authority: any, propertyId: string, today: string, checkout: string): boolean {
  return claimCoversCheckout(authority, today, checkout)
    && authority.propertyId === propertyId
    && AUTHORITY_PERMISSIONS.every((permission) => authority.permissions?.includes(permission));
}

function operatorIsEligible(operator: any, today: string, checkout: string): boolean {
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

export function isEligibleUnit(unit: any, now: Date = new Date(), dateRange?: EligibilityThrough | null): boolean {
  const today = dateKeyInLagos(now, "now");
  const checkout = dateRange?.checkOut ?? dateKeyInLagos(now, "now");
  return unit.published === true
    && unit.occupancyModel === "entire-place"
    && SUPPORTED_LOCATIONS.has(unit.location?.city)
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
  #units = new Map<string, any>();
  save(unit: any): void { this.#units.set(unit.id, structuredClone(unit)); }
  findAll(): any[] { return [...this.#units.values()].map((unit) => structuredClone(unit)); }
  findById(id: string): any { const unit = this.#units.get(id); return unit ? structuredClone(unit) : null; }
}

export class JsonUnitRepository {
  public readonly filePath: string;
  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    if (!readFileSafe(filePath)) writeFileSync(filePath, "[]", "utf8");
  }
  save(unit: any): void {
    const units = this.findAll().filter((candidate: any) => candidate.id !== unit.id);
    writeFileSync(this.filePath, JSON.stringify([...units, unit], null, 2), "utf8");
  }
  findAll(): any[] { return JSON.parse(readFileSync(this.filePath, "utf8")).map((unit: any) => structuredClone(unit)); }
  findById(id: string): any { return this.findAll().find((unit: any) => unit.id === id) ?? null; }
}

function readFileSafe(filePath: string): string | null {
  try { return readFileSync(filePath, "utf8"); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}

export function allInStayTotalKobo(unit: any, dateRange: StayDateRange | null): number | null {
  if (!dateRange) return null;
  const base = unit.price.nightlyKobo * dateRange.nights + (unit.price.mandatoryFeesKobo ?? 0);
  const taxes = calculateTaxKobo(unit.price.taxConfig, base);
  return base + taxes;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as any)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function toDiscoveryProjection(unit: Unit, dateRange: StayDateRange | null) {
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
      currency: "NGN" as const, pricingVersion: unit.price.version
    },
    trust: {
      inspection: {
        status: "current" as const, inspectedAt: unit.inspection.inspectedAt,
        expiresAt: unit.inspection.expiresAt, scope: [...unit.inspection.scope]
      },
      managementAuthority: { status: "current" as const, verifiedAt: unit.managementAuthority.verifiedAt },
      occupancyModel: "entire-place" as const
    }
  });
}

function createInteractionArtifact({ id, filters, results }: { id: string; filters: any; results: any[] }) {
  return deepFreeze({
    id, kind: "shortlet.discovery-results", schemaVersion: "shortlet.discovery/v1", projectionVersion: 1,
    domainReferences: results.map((unit: any) => ({ type: "Unit", id: unit.id })),
    policyVersions: { eligibility: "launch-2026-07", pricing: "all-in/v1" },
    disclosures: ["Rates without dates and party size are indicative; dated results show the All-In Stay Total."],
    facts: { filters: Object.freeze({ ...filters }), results: Object.freeze(results) },
    amounts: results.map((unit: any) => ({ unitId: unit.id, ...unit.price })),
    actions: results.map((unit: any) => ({ type: "view-unit", unitId: unit.id, conventionalRoute: `/stays/${unit.id}` })),
    acknowledgements: [], sensitivity: "public"
  });
}

export interface UnitDiscoveryQueryOptions {
  repository: any;
  audit: any;
  telemetry: any;
  clock?: () => Date;
  idFactory?: () => string;
}

export interface UnitDiscoveryFilters {
  readonly [key: string]: unknown;
  readonly location?: string;
  readonly neighbourhood?: string;
  readonly amenity?: string;
  readonly requiredAmenities?: readonly string[];
  readonly checkIn?: string | Date;
  readonly checkOut?: string | Date;
  readonly partySize?: number;
  readonly minPriceKobo?: number;
  readonly maxPriceKobo?: number;
}

export class UnitDiscoveryQuery {
  public readonly repository: any;
  public readonly audit: any;
  public readonly telemetry: any;
  public readonly clock: () => Date;
  public readonly idFactory: () => string;

  constructor({ repository, audit, telemetry, clock = () => new Date(), idFactory = () => crypto.randomUUID() }: UnitDiscoveryQueryOptions) {
    this.repository = repository;
    this.audit = audit;
    this.telemetry = telemetry;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  search(filters: UnitDiscoveryFilters = {}) {
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
      .filter((unit: any) => isEligibleUnit(unit, now, dateRange))
      .filter((unit: any) => !filters.location || unit.location.city === filters.location)
      .filter((unit: any) => !filters.neighbourhood || unit.location.neighbourhood === filters.neighbourhood)
      .filter((unit: any) => !filters.amenity || unit.amenities.includes(filters.amenity))
      .filter((unit: Unit) => !filters.requiredAmenities?.length
        || filters.requiredAmenities.every((required: string) => unit.amenities.includes(required)))
      .filter((unit: any) => filters.partySize === undefined || unit.capacity >= filters.partySize)
      .filter((unit: any) => !dateRange || !unit.blockedDates.some((range: any) => dateRange.overlaps(range)))
      .filter((unit: any) => filters.minPriceKobo === undefined || (allInStayTotalKobo(unit, dateRange) ?? 0) >= filters.minPriceKobo)
      .filter((unit: any) => filters.maxPriceKobo === undefined || (allInStayTotalKobo(unit, dateRange) ?? 0) <= filters.maxPriceKobo)
      .map((unit: any) => toDiscoveryProjection(unit, dateRange));
    const queryId = `search-${this.idFactory()}`;
    const artifact = createInteractionArtifact({ id: queryId, filters, results });
    this.audit.record({ type: "unit.search", queryId, filters: { ...filters }, resultUnitIds: results.map((unit: any) => unit.id) });
    this.telemetry.track({ type: "unit.search.completed", queryId, resultCount: results.length });
    return artifact;
  }
}

export function seedIssue01Units(repository: any): void {
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
