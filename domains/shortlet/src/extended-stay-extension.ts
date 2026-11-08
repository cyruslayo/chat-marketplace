import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingContract } from "./card-payment.js";
import { OPERATOR_RESPONSE_WINDOW_MINUTES } from "./booking-request.js";
import { assertContinuousOccupancy, type ContinuousOccupancyLedger } from "./continuous-occupancy.js";
import type { ExtendedStayPolicy } from "./extended-stay.js";
import { inspectionAndAuthorityCoverCheckout } from "./browse.js";
import { extendedStayExtensionPeriods, type BillingPeriodQuote } from "./quote.js";

// Monthly-stays issue 09 (ADR 0092 Extensions, ADR 0060, ADR 0023, ADR 0056, ADR 0057, ADR 0015, ADR 0041/0042/0043).
// An extension is a versioned Booking Amendment in two steps. The guest's "Request extension" records the request (the
// contract version moves, its terms do not). The Operator approves or declines it in the back office within the Operator
// Response Window (booking-request.ts); on approval the amendment commits at once and appends the Billing Periods. Existing
// periods are never repriced: the segment starts at the current checkout (ADR 0092).

export type ExtensionStatus = "awaiting_operator" | "approved" | "declined" | "expired";

/** The contract's latest extension request, kept on the contract so every composition reads the same state (ADR 0060). */
export interface ExtensionRequestRecord {
  readonly extensionId: string;
  readonly status: ExtensionStatus;
  readonly requestedAt: string;
  readonly responseDeadlineAt: string;
  readonly fromCheckOut: string;
  readonly newCheckOut: string;
  readonly addedNights: number;
  readonly addedPeriods: readonly BillingPeriodQuote[];
  readonly addedAmountKobo: number;
  readonly addedOwnerPayableKobo: number;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly amendmentId?: string;
}

/** Closed refusal codes. Every refusal leaves the contract unchanged. */
export type ExtensionRefusalCode =
  | "NOT_AUTHORIZED"
  | "NOT_OPERATOR"
  | "NOT_EXTENDED"
  | "NOT_AN_EXTENSION"
  | "NOTICE_IN_FORCE"
  | "EXTENSION_PENDING"
  | "NOT_AWAITING"
  | "TOO_LONG"
  | "UNAVAILABLE"
  | "INSPECTION_NOT_VALID"
  | "STALE"
  | "QUOTE_CHANGED"
  | "EXPIRED"
  | "NOT_FOUND";

export class ExtensionRefusedError extends Error {
  readonly code: ExtensionRefusalCode;
  constructor(code: ExtensionRefusalCode, message: string) {
    super(message);
    this.name = "ExtensionRefusedError";
    this.code = code;
  }
}

export interface ExtensionPreview {
  readonly contractId: string;
  readonly contractVersion: number;
  readonly fromCheckOut: string;
  readonly newCheckOut: string;
  readonly addedNights: number;
  readonly addedPeriods: readonly BillingPeriodQuote[];
  readonly addedAmountKobo: number;
  readonly addedOwnerPayableKobo: number;
  readonly responseWindowMinutes: number;
}

export interface ExtendedStayExtensionOptions {
  readonly contracts: {
    getContract(id: string): BookingContract;
    mutateContract(id: string, expectedVersion: number, mutation: (current: BookingContract) => BookingContract): BookingContract;
  };
  /** The unit's Extended Stay terms and price (read fail closed; a missing unit refuses). */
  readonly units: { findById(unitId: string): unknown };
  readonly calendar: { getAuthoritativeAvailability(unitId: string, checkIn: string, checkOut: string): { readonly isAvailable: boolean } };
  readonly continuousOccupancy: ContinuousOccupancyLedger;
  /** The Extended Stay policy (ADR 0092 as amended 1 Nov 2026). Absent means extensions are refused. */
  readonly extendedStayPolicy?: ExtendedStayPolicy;
  readonly clock: () => Date;
}

const DAY_MS = 86_400_000;

function nightsBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function guestAuthorized(contract: BookingContract, principal: CommandPrincipal): boolean {
  return principal.role === "guest" && !!principal.id && principal.id === contract.parties.primaryGuest.id && !!contract.tenantId && principal.tenantId === contract.tenantId;
}

function operatorAuthorized(contract: BookingContract, principal: CommandPrincipal): boolean {
  return principal.role === "operator" && !!principal.id && !!contract.tenantId && principal.tenantId === contract.tenantId;
}

/** The status a stored request has at `now`. Expiry is evaluated lazily against the clock (ADR 0106 anti-pattern 2). */
export function extensionStatusAt(record: ExtensionRequestRecord | undefined, now: Date): ExtensionStatus | undefined {
  if (!record) return undefined;
  if (record.status === "awaiting_operator" && now.getTime() >= Date.parse(record.responseDeadlineAt)) return "expired";
  return record.status;
}

/** True while an extension request is awaiting the Operator's decision at `now` (it blocks a Notice to End, ADR 0092). */
export function extensionAwaitingOperator(contract: BookingContract, now: Date): boolean {
  return extensionStatusAt(contract.extensionRequest, now) === "awaiting_operator";
}

interface ExtensionUnit {
  readonly extendedStay: { readonly optedIn?: unknown } | undefined;
  readonly price: { readonly taxConfig?: unknown };
}

function unitOf(value: unknown): ExtensionUnit {
  if (value === null || typeof value !== "object") throw new ExtensionRefusedError("NOT_FOUND", "The unit for this stay is not found");
  return value as ExtensionUnit;
}

/**
 * ADR 0092 Extensions as a versioned Booking Amendment (ADR 0060). Guest-authorised preview and request; Operator-only
 * approval or decline. Each step is one atomic `mutateContract`, so a stale or repeated step changes nothing.
 */
export class ExtendedStayExtensionManager {
  readonly #o: ExtendedStayExtensionOptions;

  constructor(options: ExtendedStayExtensionOptions) {
    this.#o = options;
  }

  /** What the guest is shown before "Request extension": the added periods, their amounts and due dates. Records nothing. */
  preview(contractId: string, principal: CommandPrincipal, newCheckOut: string): ExtensionPreview {
    const { contract, segment } = this.#prepare(contractId, principal, newCheckOut);
    return Object.freeze({
      contractId,
      contractVersion: contract.contractVersion,
      fromCheckOut: contract.dates.checkOut,
      newCheckOut,
      addedNights: nightsBetween(contract.dates.checkOut, newCheckOut),
      addedPeriods: segment.periods,
      addedAmountKobo: segment.amountKobo,
      addedOwnerPayableKobo: segment.ownerPayableKobo,
      responseWindowMinutes: OPERATOR_RESPONSE_WINDOW_MINUTES,
    });
  }

  /**
   * The extension the chat offers: one Billing Period of the policy (ADR 0092), or the nights left under the Extended Stay
   * maximum when that is fewer (the last period is then shorter, priced per night). The guest never names a number of
   * nights in chat, so the card is the only place the added dates are set. Reads only.
   */
  previewNextPeriod(contractId: string, principal: CommandPrincipal): ExtensionPreview {
    const policy = this.#o.extendedStayPolicy;
    if (!policy) throw new ExtensionRefusedError("NOT_EXTENDED", "Extensions need an Extended Stay policy (ADR 0092)");
    const contract = this.#contractFor(contractId);
    const nights = nightsBetween(contract.dates.checkIn, contract.dates.checkOut);
    const addable = Math.min(policy.billingPeriodNights, policy.maximumNights - nights);
    if (!Number.isInteger(addable) || addable < 1) throw new ExtensionRefusedError("TOO_LONG", `An Extended Stay is at most ${policy.maximumNights} nights in total`);
    const newCheckOut = new Date(Date.parse(`${contract.dates.checkOut}T00:00:00Z`) + addable * DAY_MS).toISOString().slice(0, 10);
    return this.preview(contractId, principal, newCheckOut);
  }

  /**
   * The guest's consent: records the request for the Operator. Bound to the contract version and the new checkout that
   * were shown; a stale or different confirmation is refused. No Billing Period is appended until the Operator approves.
   */
  requestExtension(contractId: string, principal: CommandPrincipal, input: { readonly newCheckOut: string; readonly contractVersion: number }): ExtensionRequestRecord {
    const { contract, segment } = this.#prepare(contractId, principal, input.newCheckOut);
    if (contract.contractVersion !== input.contractVersion) throw new ExtensionRefusedError("STALE", "The stay changed; review the extension again before requesting it");
    const now = this.#o.clock();
    const requestedAt = now.toISOString();
    const record: ExtensionRequestRecord = Object.freeze({
      extensionId: `extension:${contract.contractId}:${contract.contractVersion}:${input.newCheckOut}`,
      status: "awaiting_operator" as const,
      requestedAt,
      responseDeadlineAt: new Date(now.getTime() + OPERATOR_RESPONSE_WINDOW_MINUTES * 60_000).toISOString(),
      fromCheckOut: contract.dates.checkOut,
      newCheckOut: input.newCheckOut,
      addedNights: nightsBetween(contract.dates.checkOut, input.newCheckOut),
      addedPeriods: segment.periods,
      addedAmountKobo: segment.amountKobo,
      addedOwnerPayableKobo: segment.ownerPayableKobo,
    });
    this.#o.contracts.mutateContract(contractId, contract.contractVersion, (current) => ({
      ...current,
      contractVersion: current.contractVersion + 1,
      extensionRequest: record,
    }));
    return record;
  }

  /**
   * The Operator's approval, in the back office. Fails closed: only an operator of the contract's tenant may approve, and a
   * request past its response window expires instead. The guards are re-run and the quote must still match what was
   * requested (a repriced segment is refused, never silently committed).
   */
  approveExtension(contractId: string, operator: CommandPrincipal, extensionId: string): ExtensionRequestRecord {
    const contract = this.#contractFor(contractId);
    if (!operatorAuthorized(contract, operator)) throw new ExtensionRefusedError("NOT_OPERATOR", "Only the Operator can approve an extension");
    const pending = this.#awaiting(contract, extensionId);
    const now = this.#o.clock();
    if (now.getTime() >= Date.parse(pending.responseDeadlineAt)) {
      this.#settle(contract, { ...pending, status: "expired" }, operator.id, now);
      throw new ExtensionRefusedError("EXPIRED", "The Operator response window has passed; the stay is unchanged");
    }
    const unitId = contract.unitId;
    const segment = this.#segment(contract, pending.newCheckOut);
    if (segment.amountKobo !== pending.addedAmountKobo || segment.ownerPayableKobo !== pending.addedOwnerPayableKobo) {
      throw new ExtensionRefusedError("QUOTE_CHANGED", "The agreed amounts changed; the guest must request the extension again");
    }
    this.#guards(contract, unitId, pending.fromCheckOut, pending.newCheckOut, now);
    const amendmentId = `extension-amendment:${contract.contractId}:${contract.contractVersion}:${pending.extensionId}`;
    const decided = { ...pending, status: "approved" as const, decidedAt: now.toISOString(), decidedBy: operator.id, amendmentId };
    const committed = this.#o.contracts.mutateContract(contractId, contract.contractVersion, (current) => {
      const quote = current.quote as { readonly allInStayTotalKobo?: unknown; readonly billingPeriods?: unknown } & Record<string, unknown>;
      if (typeof quote.allInStayTotalKobo !== "number" || !Array.isArray(quote.billingPeriods)) throw new ExtensionRefusedError("QUOTE_CHANGED", "The contract has no Billing Periods to extend");
      const total = quote.allInStayTotalKobo + pending.addedAmountKobo;
      return {
        ...current,
        contractVersion: current.contractVersion + 1,
        dates: { checkIn: current.dates.checkIn, checkOut: pending.newCheckOut, nights: nightsBetween(current.dates.checkIn, pending.newCheckOut) },
        quote: { ...quote, allInStayTotalKobo: total, billingPeriods: [...(quote.billingPeriods as readonly BillingPeriodQuote[]), ...pending.addedPeriods] },
        financialSummary: {
          originalBookingTotalKobo: current.financialSummary?.originalBookingTotalKobo ?? current.totalAmountDueNowKobo,
          currentContractTotalKobo: total,
          currency: "NGN",
          amendmentAdjustments: [...(current.financialSummary?.amendmentAdjustments ?? [])],
        },
        extensionRequest: decided,
      };
    });
    return committed.extensionRequest ?? decided;
  }

  /** The Operator's decline. Nothing changes except the recorded decision; the guest is told. */
  declineExtension(contractId: string, operator: CommandPrincipal, extensionId: string): ExtensionRequestRecord {
    const contract = this.#contractFor(contractId);
    if (!operatorAuthorized(contract, operator)) throw new ExtensionRefusedError("NOT_OPERATOR", "Only the Operator can decline an extension");
    const pending = this.#awaiting(contract, extensionId);
    const now = this.#o.clock();
    if (now.getTime() >= Date.parse(pending.responseDeadlineAt)) {
      this.#settle(contract, { ...pending, status: "expired" }, operator.id, now);
      throw new ExtensionRefusedError("EXPIRED", "The Operator response window has passed; the stay is unchanged");
    }
    return this.#settle(contract, { ...pending, status: "declined" }, operator.id, now);
  }

  /** The request the guest and the Operator inbox read, with expiry evaluated at the clock. Reads only. */
  statusOf(contractId: string): { readonly record: ExtensionRequestRecord; readonly status: ExtensionStatus } | undefined {
    const contract = this.#contractFor(contractId);
    const record = contract.extensionRequest;
    const status = extensionStatusAt(record, this.#o.clock());
    return record && status ? { record, status } : undefined;
  }

  #contractFor(contractId: string): BookingContract {
    try {
      return this.#o.contracts.getContract(contractId);
    } catch {
      throw new ExtensionRefusedError("NOT_FOUND", "Booking Contract is not found");
    }
  }

  #awaiting(contract: BookingContract, extensionId: string): ExtensionRequestRecord {
    const record = contract.extensionRequest;
    if (!record || record.extensionId !== extensionId) throw new ExtensionRefusedError("NOT_AWAITING", "No such extension request is awaiting a decision");
    if (record.status !== "awaiting_operator") throw new ExtensionRefusedError("NOT_AWAITING", "This extension request has already been decided");
    return record;
  }

  #settle(contract: BookingContract, record: ExtensionRequestRecord, decidedBy: string, now: Date): ExtensionRequestRecord {
    const decided: ExtensionRequestRecord = { ...record, decidedAt: now.toISOString(), decidedBy };
    this.#o.contracts.mutateContract(contract.contractId, contract.contractVersion, (current) => ({ ...current, contractVersion: current.contractVersion + 1, extensionRequest: decided }));
    return decided;
  }

  /** Guest-facing guards (preview and request): the Extended Stay length, notice exclusivity and a pending request. */
  #prepare(contractId: string, principal: CommandPrincipal, newCheckOut: string): { contract: BookingContract; segment: SegmentQuote } {
    if (!this.#o.extendedStayPolicy) throw new ExtensionRefusedError("NOT_EXTENDED", "Extensions need an Extended Stay policy (ADR 0092)");
    const contract = this.#contractFor(contractId);
    if (!guestAuthorized(contract, principal)) throw new ExtensionRefusedError("NOT_AUTHORIZED", "Extensions are not authorized for this principal");
    const quote = contract.quote as { readonly stayType?: unknown } | undefined;
    if (quote?.stayType !== "extended") throw new ExtensionRefusedError("NOT_EXTENDED", "Only an Extended Stay can be extended; a Short Stay cannot be extended to 30 nights or more");
    if (contract.noticeToEnd) throw new ExtensionRefusedError("NOTICE_IN_FORCE", "A Notice to End is in force; an extension is not available");
    const now = this.#o.clock();
    if (extensionAwaitingOperator(contract, now)) throw new ExtensionRefusedError("EXTENSION_PENDING", "An extension request is already awaiting the Operator");
    const addedNights = nightsBetween(contract.dates.checkOut, newCheckOut);
    if (!Number.isInteger(addedNights) || addedNights < 1) throw new ExtensionRefusedError("NOT_AN_EXTENSION", "An extension must end after the current checkout");
    const totalNights = nightsBetween(contract.dates.checkIn, newCheckOut);
    if (totalNights > this.#o.extendedStayPolicy.maximumNights) throw new ExtensionRefusedError("TOO_LONG", `An Extended Stay is at most ${this.#o.extendedStayPolicy.maximumNights} nights in total`);
    const segment = this.#segment(contract, newCheckOut);
    this.#guards(contract, contract.unitId, contract.dates.checkOut, newCheckOut, now);
    return { contract, segment };
  }

  #segment(contract: BookingContract, newCheckOut: string): SegmentQuote {
    if (!this.#o.extendedStayPolicy) throw new ExtensionRefusedError("NOT_EXTENDED", "Extensions need an Extended Stay policy (ADR 0092)");
    const unit = unitOf(this.#o.units.findById(contract.unitId));
    const quote = contract.quote as { readonly billingPeriods?: readonly BillingPeriodQuote[] };
    const firstIndex = (quote.billingPeriods?.length ?? 0) + 1;
    try {
      return extendedStayExtensionPeriods({ unit: unit as never, checkIn: contract.dates.checkOut, checkOut: newCheckOut, firstIndex, policy: this.#o.extendedStayPolicy });
    } catch (error) {
      throw new ExtensionRefusedError("NOT_EXTENDED", error instanceof Error ? error.message : "The unit cannot be extended");
    }
  }

  /** Availability for the added nights, inspection and authority through the new checkout, and Continuous Occupancy. */
  #guards(contract: BookingContract, unitId: string, fromCheckOut: string, newCheckOut: string, now: Date): void {
    if (!this.#o.calendar.getAuthoritativeAvailability(unitId, fromCheckOut, newCheckOut).isAvailable) {
      throw new ExtensionRefusedError("UNAVAILABLE", "The unit is not available for every added night; the stay is unchanged");
    }
    if (!inspectionAndAuthorityCoverCheckout(this.#o.units.findById(unitId), now, newCheckOut)) {
      throw new ExtensionRefusedError("INSPECTION_NOT_VALID", "The inspection or Management Authority does not cover the new checkout (ADR 0056, ADR 0057)");
    }
    // ADR 0023 as amended 1 Nov 2026 and ADR 0092: the whole Continuous Occupancy chain stays within the Extended Stay maximum.
    assertContinuousOccupancy({
      ledger: this.#o.continuousOccupancy,
      tenantId: contract.tenantId,
      primaryGuestId: contract.parties.primaryGuest.id,
      unitId,
      checkIn: contract.dates.checkIn,
      checkOut: newCheckOut,
      now,
      policy: this.#o.extendedStayPolicy,
      exclude: { contractId: contract.contractId, offerId: contract.offerId },
    });
  }
}

type SegmentQuote = ReturnType<typeof extendedStayExtensionPeriods>;
