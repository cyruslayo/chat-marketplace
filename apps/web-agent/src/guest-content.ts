/**
 * Guest vocabulary (ADR-0077): every guest surface reads its labels from this
 * one module so wording never changes surface by surface. Domain code, types
 * and CONTEXT.md terms stay canonical; this is presentation only.
 */
export const GUEST_GLOSSARY = Object.freeze({
  // ADR-0015 and ADR-0016: canonical money labels, never shortened.
  allInStayTotal: "All-In Stay Total",
  refundableSecurityDeposit: "Refundable Security Deposit",
  // ADR-0005: a Booking Request is never presented as a Reservation.
  bookingRequest: "Booking Request",
  reservation: "Reservation",
  conditionalBookingOffer: "Conditional Booking Offer",
  offerReadyHeading: "Your offer is ready",
  // CONTEXT.md defines a Unit as a self-contained apartment or house. Launch
  // inventory is apartments; derive the noun from the Unit type if houses appear.
  unit: "apartment",
  units: "apartments",
  viewUnit: "View apartment",
  requestDraftStatus: "Not sent yet",
  // ADR-0015 revalidation before request submission, stated plainly.
  revalidation: "We re-check price and availability when you send",
  operatorFallback: "the Operator",
});

/** Internal or avoided terms that never appear in guest copy (CONTEXT.md, ADR-0016). */
export const GUEST_FORBIDDEN_TERMS: readonly RegExp[] = Object.freeze([
  /\brevalidated\b/i,
  /\bcontrolled catalogue\b/i,
  /\bguest liability\b/i,
  /\bescrow\b/i,
  /\bhosts?\b/i,
]);

/** Timeline markers for completed guest actions; rendered quietly, never as assistant turns. */
export const GUEST_RECEIPTS = Object.freeze({
  draftCreated: "Draft created",
  // Issue 14: the Guest accepted a replacement Request Draft.
  draftUpdated: "Draft updated",
  requestSent: "Booking Request sent",
  offerAccepted: "Offer accepted",
  paymentVerified: "Payment verified",
});

/**
 * Journey rail step names (issue 08). ADR-0005: "Confirmed" names the verified
 * Reservation only; every earlier step is a request-to-book stage.
 */
export const GUEST_JOURNEY = Object.freeze({
  railLabel: "Booking progress",
  search: "Search",
  stay: "Stay",
  request: "Request",
  offer: "Offer",
  pay: "Pay",
  confirmed: "Confirmed",
  backToResults: "Back to results",
});

/** Issue 13a: committed work a new conversation leaves untouched (ADR-0079). */
export type GuestCommittedWorkKind = "request" | "offer" | "reservation";

const COMMITTED_WORK_NAMES: Readonly<Record<GuestCommittedWorkKind, string>> = {
  request: GUEST_GLOSSARY.bookingRequest,
  offer: GUEST_GLOSSARY.conditionalBookingOffer,
  reservation: GUEST_GLOSSARY.reservation,
};

/**
 * Issue 13a AC1: starting a new conversation never withdraws or cancels a
 * Booking Request, offer or Reservation (ADR-0079), and the page says so.
 */
export function guestNewConversationCopy(kind: GuestCommittedWorkKind, unitTitle?: string): { readonly confirm: string; readonly stillActive: string; readonly link: string } {
  const name = COMMITTED_WORK_NAMES[kind];
  const item = `${name}${unitTitle === undefined ? "" : ` for ${unitTitle}`}`;
  return {
    confirm: `Starting a new conversation doesn't withdraw or cancel your ${item}. It stays as it is, and you can still open it.`,
    stillActive: `Your ${item} is still active. Starting this conversation didn't change it.`,
    link: `View your ${name}`,
  };
}

export const GUEST_NEW_CONVERSATION = Object.freeze({
  control: "New conversation",
  confirmHeading: "Start a new conversation?",
  confirm: "Start new conversation",
  cancel: "Stay here",
  // Shown when the live-work check can't be read; still true under ADR-0079.
  unknown: "Starting a new conversation doesn't withdraw or cancel anything you've already sent.",
});

export type GuestWaitingKind ="operator-response" | "offer-payment-window" | "payment-window";

export interface GuestWaitingCopy {
  readonly heading: string;
  readonly outcomes: readonly string[];
  readonly meanwhile: readonly string[];
}

/**
 * Issue 10: what happens next in each waiting state. Every outcome traces to
 * an ADR: 0005 (an offer after confirmation; nothing charged or reserved until
 * verified payment), 0041 (decline or timeout releases the dates), 0044 (the
 * Payment Window deadline) and 0045 (late payments are refunded). There is no
 * withdrawal at launch; the free exit is leaving the offer unaccepted
 * (decision approved 25 Sept 2026).
 */
export function guestWaitingCopy(kind: GuestWaitingKind, operatorName: string | undefined): GuestWaitingCopy {
  const operator = guestOperatorName(operatorName);
  const keepChatting = "You can keep chatting here while you wait.";
  if (kind === "operator-response") {
    return {
      heading: `Waiting for ${operator} to respond`,
      outcomes: [
        `If ${operator} confirms, you'll get a ${GUEST_GLOSSARY.conditionalBookingOffer} to review and accept.`,
        `If ${operator} declines, no payment is due and you can search again.`,
        "If there's no response by the deadline, the request expires and the dates are released.",
      ],
      meanwhile: [
        "Nothing is charged until you accept an offer and pay.",
        "If you change your mind, you can leave the offer unaccepted. When it expires, the dates are released.",
        keepChatting,
      ],
    };
  }
  const outcomes = [
    "If payment is verified before the deadline, you'll get your booking confirmation.",
    "If the deadline passes, the Payment Window expires and the dates are released.",
    "A payment that completes after the deadline is refunded and doesn't confirm the booking.",
  ];
  if (kind === "offer-payment-window") {
    return {
      heading: "Time left to accept and pay",
      outcomes,
      meanwhile: ["Nothing is charged until you accept this offer and pay. If you leave it unaccepted, it expires at the deadline.", keepChatting],
    };
  }
  return { heading: "Time left to pay", outcomes, meanwhile: [keepChatting] };
}

export function guestOperatorName(name: string | undefined): string {
  return name?.trim() || GUEST_GLOSSARY.operatorFallback;
}

/** ADR-0006: names the contracting party only where the contract can form. */
export function accommodationProviderLine(operatorName: string | undefined): string {
  return `Provided by ${guestOperatorName(operatorName)} (your accommodation provider)`;
}

export type GuestReservationStage =
  | "draft"
  | "request-delivering"
  | "request-sent"
  | "operator-confirmed"
  | "request-declined"
  | "request-expired"
  | "request-not-delivered"
  | "offer-issued"
  | "offer-accepted"
  | "offer-closed"
  | "confirmed";

/**
 * The single reservation-status statement for each guest surface (issue 07
 * AC1). ADR-0005/0006: a Reservation exists only after verified payment and
 * atomic commit, so every earlier stage says which record applies.
 */
export function guestReservationStatus(stage: GuestReservationStage): string {
  switch (stage) {
    case "draft": return `${GUEST_GLOSSARY.requestDraftStatus} · Your dates are not reserved`;
    case "request-delivering": return "Your request is being delivered. It is not yet a Reservation.";
    case "request-sent": return "This is a Booking Request, not yet a Reservation. It blocks the requested dates during the response window.";
    case "operator-confirmed": return "This is not yet a Reservation. Payment is required after you accept the Conditional Booking Offer.";
    case "request-declined": return "No Reservation was made and no payment is due. You can continue searching for another stay.";
    case "request-expired": return "The response window ended. No Reservation was made.";
    case "request-not-delivered": return "This was not an Operator decline. No Reservation was made.";
    case "offer-issued": return "Accept this Conditional Booking Offer to continue to payment. It becomes a Reservation only after payment is verified.";
    case "offer-accepted": return "It becomes a Reservation only after payment is verified.";
    case "offer-closed": return "No Reservation was made from this offer.";
    case "confirmed": return "Reservation confirmed";
  }
}

const RESERVATION_STATUS_PATTERN = /\breserv(?:e|ed|ation)s?\b|\b(?:booking|stay)(?: is)? (?:not (?:yet )?)?confirmed\b|\bdates are not held\b/gi;

/** Counts reservation-status statements across the lines of one guest surface. */
export function guestReservationStatusCount(lines: readonly string[]): number {
  return lines.reduce((count, line) => count + (line.match(RESERVATION_STATUS_PATTERN)?.length ?? 0), 0);
}

// Domain quote disclosures carry internal ledger and catalogue terms. The domain
// text is unchanged; guests see the same obligation in plain words (approved
// 25 Sept 2026; ADR-0015 optional extras, ADR-0016 separate deposit collection).
const GUEST_DISCLOSURE_WORDING: ReadonlyArray<{ readonly domain: RegExp; readonly guest: string }> = [
  { domain: /^Refundable Security Deposit is quoted separately and held as guest liability\.?$/, guest: `${GUEST_GLOSSARY.refundableSecurityDeposit} is quoted and collected separately from the stay payment.` },
  { domain: /^Optional services come strictly from the controlled catalogue with no off-platform payment\.?$/, guest: "Optional services are added only when you select them, with no off-platform payment." },
];

export function guestDisclosure(text: string): string {
  return GUEST_DISCLOSURE_WORDING.find((entry) => entry.domain.test(text.trim()))?.guest ?? text;
}

const AMENITY_LABELS: Readonly<Record<string, string>> = {
  "24_7_power_generator": "24/7 backup power",
  air_conditioning: "Air conditioning",
  generator: "Backup power",
  parking: "Secure parking",
  security_guard: "On-site security",
  swimming_pool: "Swimming pool",
  wifi: "Wi-Fi",
  workspace: "Dedicated workspace",
};

export function guestAmenityLabel(identifier: string): string {
  const acceptedLabel = AMENITY_LABELS[identifier];
  if (acceptedLabel) return acceptedLabel;
  return identifier
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function guestOccupancyLabel(identifier: string): string | undefined {
  if (identifier === "entire-place" || identifier === "entire_place") return "Entire Place";
  return undefined;
}

export function guestInspectionDisclosure(inspection: {
  readonly status: string;
  readonly inspectedAt: string;
  readonly expiresAt: string;
  readonly scope: readonly string[];
}): string | undefined {
  if (inspection.status !== "current" && inspection.status !== "passed") return undefined;
  const inspectedAt = formatGuestDate(inspection.inspectedAt);
  const expiresAt = formatGuestDate(inspection.expiresAt);
  const scope = inspection.scope.map((item) => item
    .replaceAll("-", " ")
    .replaceAll("_", " "));
  return `Physical inspection completed${inspectedAt ? ` on ${inspectedAt}` : ""}${scope.length > 0 ? `. Scope: ${scope.join(", ")}` : ""}${expiresAt ? `. Inspection expiry: ${expiresAt}` : ""}.`;
}

export function formatGuestDate(value: string): string | undefined {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Guest UI consistency issue 04: the one table of labels a presented booking fact starts with. The A2UI builders emit each
 * fact as its own Text "<label>: <value>", and the chat organizers in client.ts find facts only through these labels, so a
 * wording change cannot silently drop a surface back to Weaver's default look. Every label is existing copy or a glossary term.
 */
export const GUEST_FACT_LABELS = Object.freeze({
  checkIn: "Check-in",
  checkOut: "Check-out",
  /** "Stay: 3 nights · 2 guests": the length of the stay and the party, as the ticket's foot line. */
  stay: "Stay",
  stayDates: "Stay dates",
  where: "Where",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  sleeps: "Sleeps",
  /** Named occupants, shown under the ticket only when the Guest gave real names. */
  guests: "Guests",
  allInStayTotal: GUEST_GLOSSARY.allInStayTotal,
  refundableSecurityDeposit: `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate)`,
  /** Stands alone above the money facts while the amount is due only once the Operator accepts. */
  ifRequestAccepted: "If your request is accepted",
  /** Issue 12: everything the Guest pays to complete the booking: the stay payment plus any Refundable Security Deposit. */
  amountDueNow: "Total to complete booking",
  /** Issue 12: the one payment a payment screen asks for now (the stay payment, or the deposit when it is next). */
  thisPayment: "This payment",
  /** Issue 12: the stay payment collected; the Refundable Security Deposit has its own "collected" row. */
  amountPaid: "Stay payment paid",
  nextPayment: "Next payment",
  fitReason: "Why it fits",
  /** "Photos: 7" on a discovery card; the stay card shows it as the "1 / 7" badge over the photo. */
  photos: "Photos",
});

/** The Compare control on a discovery result, before and after the Guest picks that stay (issue 13b). */
export const GUEST_COMPARE_LABELS = Object.freeze({
  pick: "Compare",
  unpick: "Remove from compare",
});

/** Guest UI consistency issue 06: the unit-detail sheet's section heading, shared by the page and the chat organizer. */
export const UNIT_DETAIL_ABOUT_HEADING = "About this apartment";

export function guestFact(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** The value of a fact Text that starts with `label`, or undefined when the text is not that fact. */
export function guestFactValue(text: string, label: string): string | undefined {
  const prefix = `${label}: `;
  const trimmed = text.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : undefined;
}

/** The label under a stay's money figure: the All-In Stay Total for the searched nights, or the indicative nightly rate when unquoted. */
export function stayTotalLabel(quoted: boolean, nights?: number): string {
  if (!quoted) return "Indicative nightly rate";
  return nights === undefined || nights <= 0 ? GUEST_GLOSSARY.allInStayTotal : `${GUEST_GLOSSARY.allInStayTotal} for ${nights} ${nights === 1 ? "night" : "nights"}`;
}
