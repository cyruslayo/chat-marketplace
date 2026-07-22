import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

import { StayDateRange } from "./browse.js";
import { createStayQuote } from "./quote.js";

export function getWatTime(date: Date) {
  const watMs = date.getTime() + 1 * 60 * 60 * 1000;
  const watDate = new Date(watMs);
  const year = watDate.getUTCFullYear();
  const month = watDate.getUTCMonth() + 1;
  const day = watDate.getUTCDate();
  const hour = watDate.getUTCHours();
  const minute = watDate.getUTCMinutes();
  const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, dateString };
}

export interface CreateDraftOptions {
  unitId: string;
  primaryGuest: any;
  isPrimaryGuestOccupant: boolean;
  occupants?: any[];
  distinctPayer?: any;
  payerAttestationAccepted?: boolean;
  checkIn: string;
  checkOut: string;
  selectedOptionalServices?: any[];
  clock?: () => Date;
}

export class BookingRequestManager {
  #repository: any;
  #audit: any;
  #calendar: any;
  #guestVerification: any;
  #drafts = new Map<string, any>();
  #requests = new Map<string, any>();

  constructor({
    repository = null,
    audit = null,
    calendar = null,
    guestVerification = null
  }: {
    repository?: any;
    audit?: any;
    calendar?: any;
    guestVerification?: any;
  } = {}) {
    this.#repository = repository;
    this.#audit = audit;
    this.#calendar = calendar;
    this.#guestVerification = guestVerification;
  }

  createDraft({
    unitId,
    primaryGuest,
    isPrimaryGuestOccupant,
    occupants = [],
    distinctPayer = null,
    payerAttestationAccepted = false,
    checkIn,
    checkOut,
    selectedOptionalServices = [],
    clock = () => new Date()
  }: CreateDraftOptions) {
    if (!unitId) throw new Error("unitId is required to create a draft");
    if (!primaryGuest) throw new Error("primaryGuest is required to create a draft");
    if (!checkIn || !checkOut) throw new Error("checkIn and checkOut dates are required");

    const draftId = `draft-${crypto.randomUUID()}`;
    const now = clock();

    const draft = Object.freeze({
      draftId,
      unitId,
      primaryGuest: Object.freeze({ ...primaryGuest }),
      isPrimaryGuestOccupant,
      occupants: Object.freeze([...occupants]),
      distinctPayer: distinctPayer ? Object.freeze({ ...distinctPayer }) : null,
      payerAttestationAccepted,
      checkIn,
      checkOut,
      selectedOptionalServices: Object.freeze([...selectedOptionalServices]),
      status: "draft",
      createdAt: now.toISOString()
    });

    this.#drafts.set(draftId, draft);

    if (this.#audit) {
      this.#audit.record({
        type: "booking_request.draft_created",
        draftId,
        unitId,
        primaryGuestId: primaryGuest.id
      });
    }

    return draft;
  }

  getDraft(draftId: string) {
    const draft = this.#drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    return draft;
  }

  discloseBookingRequest(envelope: PlatformCommandEnvelope, { clock = () => new Date() }: { clock?: () => Date } = {}) {
    if (!envelope || !envelope.commandName || envelope.commandName !== "booking_request.disclose") {
      throw new Error("Invalid envelope: commandName must be 'booking_request.disclose'");
    }

    const { draftId } = envelope.payload ?? {};
    const draft = this.getDraft(draftId);

    const now = clock();
    const watNow = getWatTime(now);

    // 1. Stay Length & Horizon Enforcement (1 to 14 nights, rolling 90-day horizon)
    let dateRange: StayDateRange;
    try {
      dateRange = new StayDateRange(draft.checkIn, draft.checkOut, now);
    } catch (err: any) {
      if (err.message.includes("checkOut must be after checkIn") || err.message.includes("stay cannot exceed")) {
        throw new Error(`Stay length must be between 1 and 14 nights (${err.message})`);
      }
      if (err.message.includes("booking horizon")) {
        throw new Error(`Check-in date exceeds rolling 90-day booking horizon (${err.message})`);
      }
      throw err;
    }
    const nights = dateRange.nights;
    if (nights < 1 || nights > 14) {
      throw new Error(`Stay length must be between 1 and 14 nights (requested: ${nights} nights)`);
    }


    // 3. Operator Active Hours Enforcement (08:00 AM - 08:00 PM WAT daily)
    if (watNow.hour < 8 || watNow.hour >= 20) {
      throw new Error("Booking Requests can only be disclosed during Operator Active Hours (8:00 AM - 8:00 PM WAT)");
    }

    // 4. Latest Disclosure Cutoff Enforcement (At least 3 hours before 14:00 WAT check-in on check-in date -> <= 11:00 AM WAT)
    if (draft.checkIn === watNow.dateString) {
      const minutesPastMidnight = watNow.hour * 60 + watNow.minute;
      const cutoffMinutes = 11 * 60; // 11:00 AM WAT
      if (minutesPastMidnight >= cutoffMinutes) {
        throw new Error("Disclosure violates Latest Disclosure Cutoff: must be sent at least 3 hours before check-in (11:00 AM WAT on check-in date)");
      }
    }

    // 5. Identity & Occupant Verification
    if (this.#guestVerification) {
      this.#guestVerification.validateDisclosure({
        unitId: draft.unitId,
        primaryGuest: draft.primaryGuest,
        isPrimaryGuestOccupant: draft.isPrimaryGuestOccupant,
        occupants: draft.occupants,
        distinctPayer: draft.distinctPayer,
        payerAttestationAccepted: draft.payerAttestationAccepted
      });
    }

    // 6. Quote Validation
    let unit = null;
    if (this.#repository) {
      unit = this.#repository.findById
        ? this.#repository.findById(draft.unitId)
        : this.#repository.findAll().find((u: any) => u.id === draft.unitId);
    }
    if (!unit) throw new Error(`Unit not found: ${draft.unitId}`);

    const quote = createStayQuote({
      unit,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      partySize: draft.occupants.length || 1,
      selectedOptionalServices: draft.selectedOptionalServices,
      clock
    });

    // 7. Authoritative Availability & Exclusive 30-Minute Hold Creation
    if (this.#calendar) {
      const avail = this.#calendar.getAuthoritativeAvailability({
        unitId: draft.unitId,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
        clock
      });
      if (!avail.isAvailable) {
        throw new Error(`Unit unavailable for requested dates: ${avail.conflictReason}`);
      }
    }

    let hold = null;
    if (this.#calendar) {
      hold = this.#calendar.createHold({
        unitId: draft.unitId,
        holderId: draft.primaryGuest.id,
        start: draft.checkIn,
        end: draft.checkOut,
        durationMinutes: 30,
        clock
      });
    }

    const requestId = `req-${crypto.randomUUID()}`;
    const disclosedAtIso = now.toISOString();
    const deliveryDeadlineIso = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const operatorResponseDeadlineIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    const bookingRequest = {
      requestId,
      draftId,
      unitId: draft.unitId,
      operatorId: unit.operator?.id,
      primaryGuest: draft.primaryGuest,
      occupants: draft.occupants,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      nights,
      quote,
      holdId: hold?.holdId,
      disclosedAt: disclosedAtIso,
      deliveryDeadlineAt: deliveryDeadlineIso,
      operatorResponseDeadlineAt: operatorResponseDeadlineIso,
      delivered: true,
      deliveredAt: disclosedAtIso,
      status: "disclosed"
    };

    this.#requests.set(requestId, bookingRequest);

    if (this.#audit) {
      this.#audit.record({
        type: "booking_request.disclosed",
        requestId,
        draftId,
        unitId: draft.unitId,
        holdId: hold?.holdId,
        primaryGuestId: draft.primaryGuest.id,
        commandEnvelopeId: envelope.commandId,
        disclosedAt: disclosedAtIso
      });

      this.#audit.record({
        type: "booking_request.delivered",
        requestId,
        unitId: draft.unitId,
        operatorId: unit.operator?.id,
        deliveredAt: disclosedAtIso
      });
    }

    return { ...bookingRequest };
  }

  getRequest(requestId: string) {
    const req = this.#requests.get(requestId);
    if (!req) throw new Error(`Booking request not found: ${requestId}`);
    return req;
  }

  checkAndResolveExpiry(requestId: string, { clock = () => new Date() }: { clock?: () => Date } = {}) {
    const req = this.#requests.get(requestId);
    if (!req) throw new Error(`Booking request not found: ${requestId}`);

    if (req.status !== "disclosed") {
      return req;
    }

    const now = clock();
    if (now.getTime() >= new Date(req.operatorResponseDeadlineAt).getTime()) {
      req.status = "expired";
      if (req.holdId && this.#calendar) {
        this.#calendar.releaseHold(req.holdId);
      }
      if (this.#audit) {
        this.#audit.record({
          type: "booking_request.expired",
          requestId,
          unitId: req.unitId,
          expiredAt: now.toISOString()
        });
      }
    }

    return req;
  }

  confirmBookingRequest(envelope: PlatformCommandEnvelope, { clock = () => new Date() }: { clock?: () => Date } = {}) {
    if (!envelope || envelope.commandName !== "booking_request.confirm") {
      throw new Error("Invalid envelope: commandName must be 'booking_request.confirm'");
    }

    const { requestId } = envelope.payload ?? {};
    const req = this.getRequest(requestId);

    const now = clock();
    if (now.getTime() >= new Date(req.operatorResponseDeadlineAt).getTime()) {
      this.checkAndResolveExpiry(requestId, { clock });
      throw new Error("Booking request has expired and can no longer be confirmed");
    }

    if (req.status !== "disclosed") {
      throw new Error(`Cannot confirm booking request in status '${req.status}'`);
    }

    req.status = "confirmed";
    req.confirmedAt = now.toISOString();

    if (this.#audit) {
      this.#audit.record({
        type: "booking_request.operator_responded",
        requestId,
        unitId: req.unitId,
        action: "confirm",
        commandEnvelopeId: envelope.commandId,
        respondedAt: now.toISOString()
      });

      this.#audit.record({
        type: "booking_request.confirmed",
        requestId,
        unitId: req.unitId,
        confirmedAt: now.toISOString()
      });
    }

    return { ...req };
  }

  declineBookingRequest(envelope: PlatformCommandEnvelope, { clock = () => new Date() }: { clock?: () => Date } = {}) {
    if (!envelope || envelope.commandName !== "booking_request.decline") {
      throw new Error("Invalid envelope: commandName must be 'booking_request.decline'");
    }

    const { requestId, reason = "" } = envelope.payload ?? {};
    const req = this.getRequest(requestId);

    const now = clock();
    if (req.status !== "disclosed") {
      throw new Error(`Cannot decline booking request in status '${req.status}'`);
    }

    req.status = "declined";
    req.declinedAt = now.toISOString();
    req.declineReason = reason;

    if (req.holdId && this.#calendar) {
      this.#calendar.releaseHold(req.holdId);
    }

    if (this.#audit) {
      this.#audit.record({
        type: "booking_request.operator_responded",
        requestId,
        unitId: req.unitId,
        action: "decline",
        reason,
        commandEnvelopeId: envelope.commandId,
        respondedAt: now.toISOString()
      });

      this.#audit.record({
        type: "booking_request.declined",
        requestId,
        unitId: req.unitId,
        reason,
        declinedAt: now.toISOString()
      });
    }

    return { ...req };
  }
}
