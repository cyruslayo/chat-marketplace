import { PlatformCommandEnvelope, createPlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { StayDateRange } from "./browse.js";
import { createStayQuote } from "./quote.js";

export function getWatTime(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = parseInt(getPart("year"), 10);
  const month = parseInt(getPart("month"), 10);
  const day = parseInt(getPart("day"), 10);
  const hour = parseInt(getPart("hour"), 10);
  const minute = parseInt(getPart("minute"), 10);
  const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, dateString };
}

export interface OccupancyDetails {
  primaryGuest: { id: string; name: string; isGovernmentIdVerified?: boolean };
  isPrimaryGuestOccupant: boolean;
  occupants?: Array<{ name: string }>;
  distinctPayer?: { id: string; name: string } | null;
  payerAttestationAccepted?: boolean;
}

export interface CreateDraftOptions extends OccupancyDetails {
  unitId: string;
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

  createDraft(
    input: PlatformCommandEnvelope<CreateDraftOptions> | CreateDraftOptions,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ) {
    let payload: CreateDraftOptions;
    let envelopeId: string | undefined;

    if ("commandName" in input && "payload" in input) {
      if (input.commandName !== "booking_request.create_draft") {
        throw new Error("Invalid envelope: commandName must be 'booking_request.create_draft'");
      }
      payload = input.payload;
      envelopeId = input.commandId;
    } else {
      payload = input;
    }

    const {
      unitId,
      primaryGuest,
      isPrimaryGuestOccupant,
      occupants = [],
      distinctPayer = null,
      payerAttestationAccepted = false,
      checkIn,
      checkOut,
      selectedOptionalServices = []
    } = payload;

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
        primaryGuestId: primaryGuest.id,
        commandEnvelopeId: envelopeId
      });
    }

    return draft;
  }

  getDraft(draftId: string) {
    const draft = this.#drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    return draft;
  }

  discloseBookingRequest(
    envelope: PlatformCommandEnvelope<{ draftId: string; autoDeliver?: boolean }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ) {
    if (!envelope || !envelope.commandName || envelope.commandName !== "booking_request.disclose") {
      throw new Error("Invalid envelope: commandName must be 'booking_request.disclose'");
    }

    const { draftId, autoDeliver = true } = envelope.payload ?? {};
    const draft = this.getDraft(draftId);

    const now = clock();
    const watNow = getWatTime(now);

    // 1. Stay Length & Horizon Enforcement (1 to 14 nights, rolling 90-day horizon)
    let dateRange: StayDateRange;
    try {
      dateRange = new StayDateRange(draft.checkIn, draft.checkOut, now);
    } catch (err: any) {
      if (err instanceof RangeError) {
        if (err.message.includes("checkOut must be after checkIn") || err.message.includes("stay cannot exceed")) {
          throw new Error(`Stay length must be between 1 and 14 nights (${err.message})`);
        }
        if (err.message.includes("booking horizon")) {
          throw new Error(`Check-in date exceeds rolling 90-day booking horizon (${err.message})`);
        }
      }
      throw err;
    }
    const nights = dateRange.nights;

    // 2. Operator Active Hours Enforcement (08:00 AM - 08:00 PM WAT daily)
    // ADR 0041 & ADR 0042: Full 30-minute response window must fit inside Active Hours -> latest disclosure 19:30 WAT
    const currentMinutes = watNow.hour * 60 + watNow.minute;
    const activeStartMinutes = 8 * 60; // 08:00 WAT
    const activeLatestDisclosureMinutes = 19 * 60 + 30; // 19:30 WAT (so 30-min window ends at 20:00 WAT)
    if (currentMinutes < activeStartMinutes || currentMinutes > activeLatestDisclosureMinutes) {
      throw new Error("Booking Requests can only be disclosed during Operator Active Hours (8:00 AM - 8:00 PM WAT) allowing a full 30-minute response window (latest disclosure 7:30 PM WAT)");
    }

    // 3. Latest Disclosure Cutoff Enforcement (ADR 0053: Cutoff 11:00 AM WAT; 5-min delivery cannot extend past cutoff -> latest disclosure 10:55 AM WAT)
    if (draft.checkIn === watNow.dateString) {
      const latestCutoffDisclosureMinutes = 10 * 60 + 55; // 10:55 AM WAT
      if (currentMinutes > latestCutoffDisclosureMinutes) {
        throw new Error("Disclosure violates Latest Disclosure Cutoff: must be completed by 10:55 AM WAT on check-in date to allow 5-minute delivery before 11:00 AM WAT cutoff");
      }
    }

    // 4. Identity & Occupant Verification
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

    // 5. Quote Validation
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

    // 6. Authoritative Availability & Exclusive 30-Minute Hold Creation
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

    let inventoryBlock = null;
    if (this.#calendar) {
      inventoryBlock = this.#calendar.createBookingRequestBlock({
        unitId: draft.unitId,
        holderId: draft.primaryGuest.id,
        start: draft.checkIn,
        end: draft.checkOut,
        clock: () => now
      });
    }

    const requestId = `req-${crypto.randomUUID()}`;
    const disclosedAtIso = now.toISOString();
    const deliveryDeadlineIso = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const operatorResponseDeadlineIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    const isDelivered = autoDeliver;
    const deliveredAtIso = autoDeliver ? disclosedAtIso : null;

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
      inventoryCommitmentId: inventoryBlock?.commitmentId,
      holdId: inventoryBlock?.commitmentId,
      disclosedAt: disclosedAtIso,
      deliveryDeadlineAt: deliveryDeadlineIso,
      operatorResponseDeadlineAt: operatorResponseDeadlineIso,
      delivered: isDelivered,
      deliveredAt: deliveredAtIso,
      status: "disclosed"
    };

    this.#requests.set(requestId, bookingRequest);

    if (this.#audit) {
      this.#audit.record({
        type: "booking_request.disclosed",
        requestId,
        draftId,
        unitId: draft.unitId,
        holdId: inventoryBlock?.commitmentId,
        primaryGuestId: draft.primaryGuest.id,
        commandEnvelopeId: envelope.commandId,
        disclosedAt: disclosedAtIso
      });

      if (autoDeliver) {
        this.#audit.record({
          type: "booking_request.delivered",
          requestId,
          unitId: draft.unitId,
          operatorId: unit.operator?.id,
          deliveredAt: disclosedAtIso
        });
      }
    }

    return { ...bookingRequest };
  }

  getRequest(requestId: string) {
    const req = this.#requests.get(requestId);
    if (!req) throw new Error(`Booking request not found: ${requestId}`);
    return req;
  }

  markDelivered(
    envelope: PlatformCommandEnvelope<{ requestId: string }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ) {
    if (!envelope || envelope.commandName !== "booking_request.mark_delivered") {
      throw new Error("Invalid envelope: commandName must be 'booking_request.mark_delivered'");
    }

    const { requestId } = envelope.payload ?? {};
    const req = this.getRequest(requestId);
    const now = clock();

    if (req.status !== "disclosed") {
      throw new Error(`Cannot mark delivery for request in status '${req.status}'`);
    }

    if (now.getTime() >= new Date(req.deliveryDeadlineAt).getTime()) {
      this.checkAndResolveDeliveryFailure(
        createPlatformCommandEnvelope({
          commandName: "booking_request.delivery_failed",
          principal: envelope.principal,
          payload: { requestId }
        }),
        { clock }
      );
      throw new Error("Technical delivery deadline (5 minutes) expired; request delivery failed");
    }

    req.delivered = true;
    req.deliveredAt = now.toISOString();

    if (this.#audit) {
      this.#audit.record({
        type: "booking_request.delivered",
        requestId,
        unitId: req.unitId,
        operatorId: req.operatorId,
        commandEnvelopeId: envelope.commandId,
        deliveredAt: req.deliveredAt
      });
    }

    return { ...req };
  }

  checkAndResolveDeliveryFailure(
    envelope: PlatformCommandEnvelope<{ requestId: string }> | { requestId: string },
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ) {
    const requestId = "commandName" in envelope ? envelope.payload.requestId : envelope.requestId;
    const envelopeId = "commandName" in envelope ? envelope.commandId : undefined;
    const req = this.#requests.get(requestId);
    if (!req) throw new Error(`Booking request not found: ${requestId}`);

    if (req.status !== "disclosed" || req.delivered) {
      return req;
    }

    const now = clock();
    if (now.getTime() >= new Date(req.deliveryDeadlineAt).getTime()) {
      req.status = "delivery_failed";
      if (req.inventoryCommitmentId && this.#calendar) {
        this.#calendar.releaseBookingRequestBlock(req.inventoryCommitmentId, { clock });
      }
      if (this.#audit) {
        this.#audit.record({
          type: "booking_request.delivery_failed",
          requestId,
          unitId: req.unitId,
          commandEnvelopeId: envelopeId,
          failedAt: now.toISOString()
        });
      }
    }

    return req;
  }

  checkAndResolveExpiry(
    envelope: PlatformCommandEnvelope<{ requestId: string }> | { requestId: string },
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ) {
    const requestId = "commandName" in envelope ? envelope.payload.requestId : envelope.requestId;
    const envelopeId = "commandName" in envelope ? envelope.commandId : undefined;

    const req = this.#requests.get(requestId);
    if (!req) throw new Error(`Booking request not found: ${requestId}`);

    if (req.status !== "disclosed") {
      return req;
    }

    const now = clock();
    if (now.getTime() >= new Date(req.operatorResponseDeadlineAt).getTime()) {
      req.status = "expired";
      if (req.inventoryCommitmentId && this.#calendar) {
        this.#calendar.releaseBookingRequestBlock(req.inventoryCommitmentId, { clock });
      }
      if (this.#audit) {
        this.#audit.record({
          type: "booking_request.expired",
          requestId,
          unitId: req.unitId,
          commandEnvelopeId: envelopeId,
          expiredAt: now.toISOString()
        });
      }
    }

    return req;
  }

  confirmBookingRequest(envelope: PlatformCommandEnvelope<{ requestId: string }>, { clock = () => new Date() }: { clock?: () => Date } = {}) {
    if (!envelope || envelope.commandName !== "booking_request.confirm") {
      throw new Error("Invalid envelope: commandName must be 'booking_request.confirm'");
    }

    const { requestId } = envelope.payload ?? {};
    const req = this.getRequest(requestId);

    const now = clock();

    // Check delivery failure or expiry
    if (!req.delivered && now.getTime() >= new Date(req.deliveryDeadlineAt).getTime()) {
      this.checkAndResolveDeliveryFailure(envelope, { clock });
      throw new Error("Booking request delivery failed and cannot be confirmed");
    }

    if (now.getTime() >= new Date(req.operatorResponseDeadlineAt).getTime()) {
      this.checkAndResolveExpiry(envelope, { clock });
      throw new Error("Booking request has expired and can no longer be confirmed");
    }

    if (req.status !== "disclosed") {
      throw new Error(`Cannot confirm booking request in status '${req.status}'`);
    }

    if (!req.inventoryCommitmentId || !this.#calendar) {
      throw new Error("Booking request inventory commitment is required for confirmation");
    }

    this.#calendar.transitionBookingRequestBlockToPaymentPending({
      commitmentId: req.inventoryCommitmentId,
      unitId: req.unitId,
      start: req.checkIn,
      end: req.checkOut,
      clock: () => now
    });

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

  declineBookingRequest(envelope: PlatformCommandEnvelope<{ requestId: string; reason?: string }>, { clock = () => new Date() }: { clock?: () => Date } = {}) {
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

    if (req.inventoryCommitmentId && this.#calendar) {
      this.#calendar.releaseBookingRequestBlock(req.inventoryCommitmentId, { clock });
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
