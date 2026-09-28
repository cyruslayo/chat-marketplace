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

  /**
   * B8: releases an active Operator Block and takes the same range out of the discovery projection, so Guests can
   * find the dates again. Other commitments on those dates are untouched and still hold them (ADR 0039).
   */
  releaseOperatorBlock(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): AvailabilityCommitment {
    const released = this.#store.releaseOperatorBlock(commitmentId, clock().toISOString());
    if (this.#audit) {
      this.#audit.record({ type: "availability.operator_block_released", unitId: released.unitId, commitmentId, start: released.start, end: released.end });
    }
    if (this.#repository) {
      const unit = this.#repository.findById
        ? this.#repository.findById(released.unitId)
        : this.#repository.findAll?.().find((candidate) => candidate.id === released.unitId) ?? null;
      const ranges = unit?.blockedDates ?? [];
      const index = ranges.findIndex((range) => dateValue(range.start) === released.start && dateValue(range.end) === released.end);
      if (unit && index >= 0) {
        unit.blockedDates = [...ranges.slice(0, index), ...ranges.slice(index + 1)];
        this.#repository.save(unit);
      }
    }
    return released;
  }

  /** Every active commitment overlapping [start, end), with expiry evaluated against the clock first. */
  listActiveCommitments({ unitId, start, end, clock = () => new Date() }: { unitId: string; start: DateValue; end: DateValue; clock?: Clock }): AvailabilityCommitment[] {
    return this.#store.findActive(unitId, dateValue(start), dateValue(end), clock().toISOString());
  }

  /** One commitment in any state, or null. */
  findCommitment(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): AvailabilityCommitment | null {
    return this.#store.findCommitment(commitmentId, clock().toISOString());
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

  /**
   * ADR 0041: a disclosed request's exclusive block. It lasts 30 minutes by default; a request still in Delivery
   * Pending passes its 5-minute delivery deadline instead (ADR 0043) and is extended on acceptance.
   */
  createBookingRequestBlock({ unitId, holderId, start, end, expiresAt, clock = () => new Date() }: { unitId: string; holderId: string; start: DateValue; end: DateValue; expiresAt?: DateValue; clock?: Clock }) {
    const now = clock();
    const commitment = this.#store.create({
      commitmentId: `brb-${crypto.randomUUID()}`,
      unitId,
      kind: "booking_request_block",
      start: dateValue(start),
      end: dateValue(end),
      createdAt: now.toISOString(),
      expiresAt: expiresAt === undefined ? new Date(now.getTime() + 30 * 60 * 1000).toISOString() : dateValue(expiresAt),
      holderId
    });
    if (!commitment.expiresAt) throw new Error("Booking request block must expire");
    return { commitmentId: commitment.commitmentId, unitId: commitment.unitId, holderId: commitment.holderId ?? holderId, start, end, createdAt: commitment.createdAt, expiresAt: commitment.expiresAt };
  }

  /** Issue 09 (ADR 0043): on delivery, move a still-active request block forward to the fresh response deadline. */
  extendBookingRequestBlock(commitmentId: string, expiresAt: DateValue, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.extendBookingRequestBlock(commitmentId, dateValue(expiresAt), clock().toISOString());
  }

  releaseBookingRequestBlock(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.releaseBookingRequestBlock(commitmentId, clock().toISOString());
  }

  releasePaymentPending(commitmentId: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.releasePaymentPending(commitmentId, clock().toISOString());
  }

  releaseConfirmedBooking({ commitmentId, unitId, start, end, clock = () => new Date() }: { commitmentId: string; unitId: string; start: DateValue; end: DateValue; clock?: Clock }): void {
    this.#store.releaseConfirmedBooking(commitmentId, unitId, dateValue(start), dateValue(end), clock().toISOString());
  }

  transitionBookingRequestBlockToPaymentPending({ commitmentId, unitId, start, end, clock = () => new Date() }: { commitmentId: string; unitId: string; start: DateValue; end: DateValue; clock?: Clock }) {
    return this.#store.transitionBookingRequestBlockToPaymentPending({ commitmentId, unitId, start: dateValue(start), end: dateValue(end), now: clock().toISOString() });
  }

  extendPaymentPending(commitmentId: string, expiresAt: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.extendPaymentPending(commitmentId, expiresAt, clock().toISOString());
  }

  /** ADR 0090: extend a still-active Payment Pending block to a manual transfer's verification deadline. */
  holdPaymentPendingUntil(commitmentId: string, expiresAt: string, { clock = () => new Date() }: { clock?: Clock } = {}): void {
    this.#store.holdPaymentPendingUntil(commitmentId, expiresAt, clock().toISOString());
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

/** A night's state on the back-office calendar (B8). Each maps from one commitment kind (ADR 0039, 0040). */
export type CalendarDayState = "available" | "request_pending" | "payment_pending" | "booked" | "blocked" | "held";

export interface CalendarDay {
  /** The night, YYYY-MM-DD: the stay's check-in day up to, not including, check-out. */
  readonly date: string;
  readonly state: CalendarDayState;
}

const DAY_STATE: Readonly<Record<AvailabilityCommitmentKind, CalendarDayState>> = {
  booking_request_block: "request_pending",
  payment_pending: "payment_pending",
  confirmed_booking: "booked",
  operator_block: "blocked",
  operator_hold: "held",
};

/** Hardest to displace first (ADR 0039): a paid booking, then a confirmed request, then an unconfirmed one. */
const DAY_PRECEDENCE: readonly CalendarDayState[] = ["booked", "payment_pending", "request_pending", "blocked", "held"];

function dayKey(value: string): string {
  return value.slice(0, 10);
}

/** The YYYY-MM-DD date `days` after `date` (negative for before). */
export function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Each night's state from active commitments. A night with none is available. */
export function projectCalendarDays(commitments: readonly AvailabilityCommitment[], nights: readonly string[]): CalendarDay[] {
  return nights.map((date) => {
    const states = commitments
      .filter((commitment) => dayKey(commitment.start) <= date && date < dayKey(commitment.end))
      .map((commitment) => DAY_STATE[commitment.kind]);
    return { date, state: DAY_PRECEDENCE.find((state) => states.includes(state)) ?? "available" };
  });
}

export type OperatorBlockConflict = Exclude<CalendarDayState, "available">;

/**
 * ADR 0039: a new Operator Block never silently displaces a commitment. It takes effect only with none overlapping.
 * An unconfirmed request must be declined first; a confirmed (Payment Pending) one needs human incident handling;
 * a paid booking cannot be overridden. ADR 0040: a block does not replace an Operator Hold.
 */
export function operatorBlockConflict(overlapping: readonly AvailabilityCommitment[]): { readonly conflict: OperatorBlockConflict; readonly commitment: AvailabilityCommitment } | null {
  for (const conflict of DAY_PRECEDENCE) {
    const commitment = overlapping.find((candidate) => DAY_STATE[candidate.kind] === conflict);
    if (commitment) return { conflict: conflict as OperatorBlockConflict, commitment };
  }
  return null;
}

export { AvailabilityConflictError };
