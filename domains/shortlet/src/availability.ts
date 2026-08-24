import {
  AvailabilityConflictError,
  SqliteAvailabilityStore,
  type AvailabilityCommitment,
  type AvailabilityCommitmentKind
} from "./availability-store.js";

export interface AvailabilityCalendarOptions {
  repository?: UnitRepositoryLike | null;
  audit?: AuditLogLike | null;
  store?: SqliteAvailabilityStore;
}

interface UnitLike {
  id: string;
  blockedDates?: Array<{ start: string | Date; end: string | Date }>;
}

interface UnitRepositoryLike {
  findById?: (id: string) => UnitLike | null;
  findAll?: () => UnitLike[];
  save: (unit: UnitLike) => void;
}

interface AuditLogLike {
  record: (entry: Record<string, unknown>) => void;
}

type DateValue = string | Date;

type Clock = () => Date;

function dateValue(value: DateValue): string {
  return value instanceof Date ? value.toISOString() : value;
}

function conflictReason(commitment: AvailabilityCommitment): string {
  if (commitment.kind === "operator_block") return "Overlaps with Operator Block";
  if (commitment.kind === "booking_request_block") return "Overlaps with Booking Request Block";
  if (commitment.kind === "payment_pending") return "Overlaps with Payment Pending";
  if (commitment.kind === "confirmed_booking") return "Overlaps with confirmed Booking";
  return "Overlaps with active Hold";
}

export class AvailabilityCalendar {
  #repository: UnitRepositoryLike | null;
  #audit: AuditLogLike | null;
  readonly #store: SqliteAvailabilityStore;

  constructor({ repository = null, audit = null, store = new SqliteAvailabilityStore(":memory:") }: AvailabilityCalendarOptions = {}) {
    this.#repository = repository;
    this.#audit = audit;
    this.#store = store;
  }

  addOperatorBlock({ unitId, operatorId, start, end, reason = "", clock = () => new Date() }: { unitId: string; operatorId: string; start: DateValue; end: DateValue; reason?: string; clock?: Clock }) {
    const createdAt = clock().toISOString();
    const block = this.#store.create({
      commitmentId: `blk-${crypto.randomUUID()}`,
      unitId,
      kind: "operator_block",
      start: dateValue(start),
      end: dateValue(end),
      createdAt,
      operatorId,
      reason
    });

    if (this.#audit) {
      this.#audit.record({ type: "availability.operator_block", unitId, operatorId, start, end, reason });
    }

    // browse.ts still consumes Unit.blockedDates. Keep it as a derived compatibility projection;
    // all AvailabilityCalendar conflict decisions come from the injected SQLite store (ADR 0039).
    if (this.#repository) {
      const unit = this.#repository.findById
        ? this.#repository.findById(unitId)
        : this.#repository.findAll?.().find((candidate) => candidate.id === unitId) ?? null;
      if (unit) {
        unit.blockedDates = unit.blockedDates ?? [];
        unit.blockedDates.push({ start, end });
        this.#repository.save(unit);
      }
    }

    return {
      blockId: block.commitmentId,
      unitId: block.unitId,
      operatorId: block.operatorId ?? operatorId,
      start,
      end,
      reason: block.reason ?? reason,
      createdAt: block.createdAt
    };
  }

  createOperatorHold({ unitId, operatorId, start, end, clock = () => new Date() }: { unitId: string; operatorId: string; start: DateValue; end: DateValue; clock?: Clock }) {
    const createdAt = clock();
    const hold = this.#store.create({
      commitmentId: `oph-${crypto.randomUUID()}`,
      unitId,
      kind: "operator_hold",
      start: dateValue(start),
      end: dateValue(end),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 45 * 60 * 1000).toISOString(),
      operatorId,
      extensionCount: 0
    });
    if (!hold.expiresAt) throw new Error("Created Operator Hold must expire");
    return {
      holdId: hold.commitmentId,
      commitmentId: hold.commitmentId,
      unitId: hold.unitId,
      operatorId: hold.operatorId ?? operatorId,
      start,
      end,
      createdAt: hold.createdAt,
      expiresAt: hold.expiresAt,
      extensionCount: hold.extensionCount,
      kind: hold.kind
    };
  }

  releaseOperatorHold(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.releaseOperatorHold(commitmentId, clock().toISOString());
  }

  createBookingRequestBlock({ unitId, holderId, start, end, clock = () => new Date() }: { unitId: string; holderId: string; start: DateValue; end: DateValue; clock?: Clock }) {
    const now = clock();
    const commitment = this.#store.create({
      commitmentId: `brb-${crypto.randomUUID()}`,
      unitId,
      kind: "booking_request_block",
      start: dateValue(start),
      end: dateValue(end),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      holderId
    });
    if (!commitment.expiresAt) throw new Error("Booking request block must expire");
    return { commitmentId: commitment.commitmentId, unitId: commitment.unitId, holderId: commitment.holderId ?? holderId, start, end, createdAt: commitment.createdAt, expiresAt: commitment.expiresAt };
  }

  releaseBookingRequestBlock(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.releaseBookingRequestBlock(commitmentId, clock().toISOString());
  }

  releasePaymentPending(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.releasePaymentPending(commitmentId, clock().toISOString());
  }

  transitionBookingRequestBlockToPaymentPending({ commitmentId, unitId, start, end, clock = () => new Date() }: { commitmentId: string; unitId: string; start: DateValue; end: DateValue; clock?: Clock }) {
    return this.#store.transitionBookingRequestBlockToPaymentPending({ commitmentId, unitId, start: dateValue(start), end: dateValue(end), now: clock().toISOString() });
  }

  transitionPaymentPendingToConfirmedBooking({ commitmentId, unitId, start, end, clock = () => new Date() }: { commitmentId: string; unitId: string; start: DateValue; end: DateValue; clock?: Clock }) {
    return this.#store.transitionPaymentPendingToConfirmedBooking({ commitmentId, unitId, start: dateValue(start), end: dateValue(end), now: clock().toISOString() });
  }

  extendOperatorHold(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}) {
    const hold = this.#store.extendOperatorHold(commitmentId, clock().toISOString());
    if (!hold.expiresAt) throw new Error("Extended Operator Hold must expire");
    return {
      holdId: hold.commitmentId,
      commitmentId: hold.commitmentId,
      unitId: hold.unitId,
      operatorId: hold.operatorId,
      start: hold.start,
      end: hold.end,
      createdAt: hold.createdAt,
      expiresAt: hold.expiresAt,
      extensionCount: hold.extensionCount,
      kind: hold.kind
    };
  }

  assertActiveCommitment({ commitmentId, unitId, start, end, expectedKind, clock = () => new Date() }: { commitmentId?: string; unitId: string; start: DateValue; end: DateValue; expectedKind?: AvailabilityCommitmentKind; clock?: Clock }): AvailabilityCommitment {
    if (!commitmentId) throw new Error("Availability commitment is required");
    return this.#store.assertActiveCommitment(commitmentId, unitId, dateValue(start), dateValue(end), clock().toISOString(), expectedKind);
  }

  getAuthoritativeAvailability(options: { unitId: string; checkIn: DateValue; checkOut: DateValue; clock?: Clock }): { isAvailable: boolean; conflictReason?: string; unitId: string; checkIn: DateValue; checkOut: DateValue };
  getAuthoritativeAvailability(unitId: string, checkIn: DateValue, checkOut: DateValue, clock?: Clock): { isAvailable: boolean; conflictReason?: string; unitId: string; checkIn: DateValue; checkOut: DateValue };
  getAuthoritativeAvailability(
    optionsOrUnitId: { unitId: string; checkIn: DateValue; checkOut: DateValue; clock?: Clock } | string,
    positionalCheckIn?: DateValue,
    positionalCheckOut?: DateValue,
    positionalClock?: Clock
  ) {
    const positional = typeof optionsOrUnitId === "string";
    const options = positional
      ? { unitId: optionsOrUnitId, checkIn: positionalCheckIn!, checkOut: positionalCheckOut!, clock: positionalClock }
      : optionsOrUnitId;
    const { unitId, checkIn, checkOut, clock = () => new Date() } = options;
    const commitments = this.#store.findActive(unitId, dateValue(checkIn), dateValue(checkOut), clock().toISOString());
    const conflict = commitments[0];
    if (conflict) {
      return { isAvailable: false, conflictReason: conflictReason(conflict), unitId, checkIn, checkOut };
    }
    return { isAvailable: true, unitId, checkIn, checkOut };
  }
}

export { AvailabilityConflictError };
