import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SUPPORTED_LOCATIONS = new Set(["Lagos", "Abuja"]);
const MAX_STAY_NIGHTS = 14;
const BOOKING_HORIZON_DAYS = 90;

function asDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date`);
  return date;
}

function overlaps(start, end, blockedRange) {
  return new Date(start) < new Date(blockedRange.end) && new Date(blockedRange.start) < new Date(end);
}

export function dateRangeOverlaps(start, end, ranges = []) {
  return ranges.some((range) => overlaps(start, end, range));
}

export function isEligibleUnit(unit, now = new Date(), checkout) {
  const inspectionExpiry = asDate(unit.inspection.expiresAt, "inspection.expiresAt");
  const authorityExpiry = asDate(unit.managementAuthority.expiresAt, "managementAuthority.expiresAt");
  return unit.published === true
    && unit.occupancyModel === "entire-place"
    && SUPPORTED_LOCATIONS.has(unit.location.city)
    && unit.inspection.status === "passed"
    && inspectionExpiry > (checkout ? asDate(checkout, "checkOut") : now)
    && unit.managementAuthority.status === "current"
    && authorityExpiry > (checkout ? asDate(checkout, "checkOut") : now);
}

export class UnitRepository {
  #units = new Map();

  save(unit) {
    this.#units.set(unit.id, structuredClone(unit));
  }

  findAll() {
    return [...this.#units.values()].map((unit) => structuredClone(unit));
  }
}

/** A small durable adapter used by the tracer; the query remains storage-agnostic. */
export class JsonUnitRepository {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    if (!readFileSyncSafe(filePath)) writeFileSync(filePath, "[]", "utf8");
  }

  save(unit) {
    const units = this.findAll().filter((candidate) => candidate.id !== unit.id);
    units.push(unit);
    writeFileSync(this.filePath, JSON.stringify(units, null, 2), "utf8");
  }

  findAll() {
    return JSON.parse(readFileSync(this.filePath, "utf8")).map((unit) => structuredClone(unit));
  }
}

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export class UnitDiscoveryQuery {
  constructor({ repository, audit, telemetry, clock = () => new Date() }) {
    this.repository = repository;
    this.audit = audit;
    this.telemetry = telemetry;
    this.clock = clock;
  }

  search(filters = {}) {
    const now = this.clock();
    const hasDates = filters.checkIn !== undefined || filters.checkOut !== undefined;
    if (hasDates) {
      if (!filters.checkIn || !filters.checkOut) throw new TypeError("checkIn and checkOut are required together");
      const checkIn = asDate(filters.checkIn, "checkIn");
      const checkOut = asDate(filters.checkOut, "checkOut");
      if (checkIn >= checkOut) throw new RangeError("checkOut must be after checkIn");
      const nights = Math.ceil((checkOut - checkIn) / 86400000);
      if (nights > MAX_STAY_NIGHTS) throw new RangeError(`stay cannot exceed ${MAX_STAY_NIGHTS} nights`);
      if (checkIn < now || checkIn > new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86400000)) {
        throw new RangeError(`check-in must be within the ${BOOKING_HORIZON_DAYS}-day booking horizon`);
      }
    }
    if (filters.partySize !== undefined && (!Number.isInteger(filters.partySize) || filters.partySize < 1)) {
      throw new RangeError("partySize must be a positive integer");
    }

    const results = this.repository.findAll()
      .filter((unit) => isEligibleUnit(unit, now, filters.checkOut))
      .filter((unit) => !filters.location || unit.location.city === filters.location)
      .filter((unit) => !filters.amenity || unit.amenities.includes(filters.amenity))
      .filter((unit) => filters.partySize === undefined || unit.capacity >= filters.partySize)
      .filter((unit) => filters.minPriceKobo === undefined || unit.price.nightlyKobo >= filters.minPriceKobo)
      .filter((unit) => filters.maxPriceKobo === undefined || unit.price.nightlyKobo <= filters.maxPriceKobo)
      .filter((unit) => !hasDates || !dateRangeOverlaps(filters.checkIn, filters.checkOut, unit.blockedDates))
      .map((unit) => toDiscoveryProjection(unit, filters.checkIn, filters.checkOut));

    const queryId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.audit.record({ type: "unit.search", queryId, filters: { ...filters }, resultUnitIds: results.map((unit) => unit.id) });
    this.telemetry.track({ type: "unit.search.completed", queryId, resultCount: results.length });
    return results;
  }
}

export function toDiscoveryProjection(unit, checkIn, checkOut) {
  const nights = checkIn && checkOut ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000) : null;
  const mandatoryFeesKobo = unit.price.mandatoryFeesKobo ?? 0;
  return Object.freeze({
    id: unit.id,
    title: unit.title,
    location: { city: unit.location.city, neighbourhood: unit.location.neighbourhood },
    capacity: unit.capacity,
    amenities: [...unit.amenities],
    price: {
      nightlyKobo: unit.price.nightlyKobo,
      allInStayTotalKobo: nights === null ? null : unit.price.nightlyKobo * nights + mandatoryFeesKobo,
      mandatoryFeesKobo,
      currency: "NGN"
    },
    trust: {
      inspection: "current",
      managementAuthority: "current",
      occupancyModel: "entire-place"
    }
  });
}

export function seedIssue01Units(repository) {
  repository.save({
    id: "unit-lagos-001",
    title: "Sunlit 2-bedroom apartment in Ikeja",
    location: { city: "Lagos", neighbourhood: "Ikeja" },
    occupancyModel: "entire-place",
    capacity: 4,
    amenities: ["wifi", "generator", "parking"],
    price: { nightlyKobo: 8500000, mandatoryFeesKobo: 1000000 },
    published: true,
    inspection: { status: "passed", expiresAt: "2027-01-15T00:00:00.000Z" },
    managementAuthority: { status: "current", expiresAt: "2027-02-01T00:00:00.000Z" },
    blockedDates: []
  });
  repository.save({
    id: "unit-abuja-expired",
    title: "Expired inspection unit",
    location: { city: "Abuja", neighbourhood: "Wuse" },
    occupancyModel: "entire-place",
    capacity: 4,
    amenities: ["wifi"],
    price: { nightlyKobo: 7000000, mandatoryFeesKobo: 500000 },
    published: true,
    inspection: { status: "passed", expiresAt: "2025-01-01T00:00:00.000Z" },
    managementAuthority: { status: "current", expiresAt: "2027-01-01T00:00:00.000Z" },
    blockedDates: []
  });
}
