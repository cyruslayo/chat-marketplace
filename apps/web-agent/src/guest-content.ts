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

/** Server-authored concierge copy for replies whose facts come from current pack projections. */
export const GUEST_ASSISTANT_COPY = Object.freeze({
  stayClarification: "How many nights will you be staying, and for how many guests?",
  // Issue 08 (ADR 0106): an area the server does not know is refused with the closed list of areas it can search.
  areaClarification: (examples: string) => `I couldn't find that area. Which area should I search? For example: ${examples}.`,
  // Issue 07 (ADR 0106, ADR 0015): a budget the server cannot read from the guest's own words is refused, never searched as a guessed amount.
  budgetClarification: "I could not read that budget. Please give an amount, for example 150k a night or 500k for the stay.",
  // ADR 0106: a planner date that the guest's text does not state is rejected and the guest is asked for dates in a form the server reads.
  datesClarification: "I need your check-in and checkout dates before I can search. Please write them with the day, month and year, for example 20 November 2026 to 23 November 2026.",
  // ADR 0015: a Unit's all-in price is quoted for the stay's dates, so opening one without dates asks for them.
  unitDatesClarification: "Add your check-in and checkout dates to see this apartment's price for your stay. Please write them with the day, month and year, for example 20 November 2026 to 23 November 2026.",
  // Issue 04 (ADR 0106 2 Nov 2026, ADR 0080, ADR 0077): the show-back of a relative date the guest must confirm. The deterministic
  // path says the same sentence (concierge.ts), so both paths show the same dates before a search.
  dateShowBack: (arriving: string, leaving: string, nights: number, guests: number, place: string) =>
    `Just to check: arriving ${arriving} and leaving ${leaving} (${nights} ${nights === 1 ? "night" : "nights"}), ${guests} ${guests === 1 ? "guest" : "guests"} in ${place}. Shall I search these dates? Reply "yes", or tell me different dates.`,
  // Issue 04: an ambiguous phrase names its candidate days; one chip per day, and a tap chooses it.
  // Issue 13b (ADR 0106, 2 Nov 2026; ADR 0080): the same date check while a Request Draft is open. "yes" updates the draft; nothing is searched.
  draftDateShowBack: (arriving: string, leaving: string, nights: number, guests: number) =>
    `Just to check: arriving ${arriving} and leaving ${leaving} (${nights} ${nights === 1 ? "night" : "nights"}), ${guests} ${guests === 1 ? "guest" : "guests"}. Shall I show your Request Draft with these dates? Reply "yes", or tell me different dates.`,
  dateChoice: (days: readonly string[]) => `Which day do you mean: ${days.join(" or ")}?`,
  dateConfirmChip: "Yes",
  dateChangeChip: "Change dates",
  safeClarification: "I can help you find and compare stays, explain pricing, or check a booking status. What would you like to do?",
  // Shown when a turn is slower than a normal one; the guest is not told the request failed.
  stillWorking: "Still working on your request. A stay search can take a little longer, so please keep this page open.",
  // ADR 0067 governs the support window and active-stay on-call coverage.
  generalSupport: "General human support is available daily from 8:00 AM to 8:00 PM WAT. Use the existing support channel provided with your stay.",
  activeStayEmergencySupport: "Active stays have 24/7 Human Incident Support. Use Active-Stay Emergency Support through your existing booking support route.",
  detailsReady: "The current stay details are ready below.",
  statusReady: "The current booking information is ready below.",
  results: (count: number, location: string) => `I found ${count} matching ${count === 1 ? "stay" : "stays"} in ${location}.`,
  noResults: (location: string) => `I couldn't find any eligible stays matching those requirements in ${location}.`,
  priceUnavailable: "Current price facts are not available. Review the current stay details before you continue.",
  details: (title: string, amenities: string, inspectionPassed: boolean) => `${title} offers ${amenities || "the listed amenities"}, entire place possession${inspectionPassed ? " and passed physical inspection" : ""}.`,
  comparedAllIn: (first: string, firstTotal: string, firstNight: string, second: string, secondTotal: string, secondNight: string) => `Comparing both options: ${first} has an All-In Stay Total of ${firstTotal}, with a nightly rate of ${firstNight}/night; ${second} has an All-In Stay Total of ${secondTotal}, with a nightly rate of ${secondNight}/night.`,
  comparedAllInOnly: (first: string, firstTotal: string, second: string, secondTotal: string) => `Comparing both options: ${first} has an All-In Stay Total of ${firstTotal}; ${second} has an All-In Stay Total of ${secondTotal}.`,
  comparedIndicative: (first: string, firstNight: string, second: string, secondNight: string) => `Comparing both options: ${first} has an indicative nightly rate of ${firstNight}, while ${second} has an indicative nightly rate of ${secondNight}. Current All-In Stay Totals are not available for this comparison.`,
  comparisonNoPrice: "I can compare the stays, but current price facts are not available.",
  priceBreakdown: (title: string, total: string, fees: string, deposit: string) => `For ${title}, the All-In Stay Total is ${total}, including mandatory fees of ${fees}. The refundable security deposit is shown separately as ${deposit}.`,
  draftReady: "Your Request Draft is ready to review. It has not been submitted.",
  offerInactive: "This Conditional Booking Offer is no longer active. Review the current booking details before continuing.",
  offerAmount: (total: string, due: string, deposit: string) => `The offer's All-In Stay Total is ${total}. The amount due now is ${due}. The refundable security deposit is shown separately as ${deposit}. Review the offer before accepting it.`,
  confirmedBooking: (contractId: string) => `Your booking is confirmed under contract reference ${contractId}.`,
  issuedOffer: (offerId: string) => `The Accommodation Provider has issued a Conditional Booking Offer under offer reference ${offerId}.`,
  disclosedRequest: (requestId: string) => `Your Booking Request ${requestId} has been disclosed and is awaiting the Accommodation Provider's response.`,
  noCurrentBooking: "You currently have no active booking or pending request.",
});

export const GUEST_COMMERCE_ASSISTANT_COPY = Object.freeze({
  searchResults: (count: number) => `I found ${count} current product ${count === 1 ? "offer" : "offers"}. Review the Commerce results below.`,
  offer: "I found the current Merchant Offer. Review its details on the Commerce surface.",
  delivery: (count: number) => `I found ${count} current delivery ${count === 1 ? "option" : "options"}. Review the quotes below.`,
  cart: "I updated the Store Cart. Review its current quantities and prices below.",
  orderStatus: (status: string) => `The current Merchant Order status is ${status}.`,
  safeClarification: "I can help you search products, review an offer, check delivery options, or review an order status. What would you like to do?",
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

/**
 * Shell task rail (slice 26). Domain labels and task statuses come from the pack;
 * this is the one copy source for the rail's accessible chrome.
 */
export const GUEST_TASK_RAIL = Object.freeze({
  railLabel: "Conversation tasks",
  currentTask: "Current task",
  openTask: "Open task",
  updates: "updates",
});

/** Vertical starter cards (slice 26): the PRD names the two launch verticals Stays and Shop. */
export const GUEST_VERTICALS = Object.freeze({
  heading: "What would you like to do?",
  staysDescription: "Find an inspected apartment in Lagos or Abuja and book it.",
  shopDescription: "Browse products from verified merchants.",
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

/** Issue 14 / ADR-0079: shown when a landing message arrives and the Guest already has a conversation open. */
export const GUEST_CONTINUE_CONVERSATION = Object.freeze({
  heading: "You already have a conversation open",
  lede: "Pick up where you left off, or start a new conversation with the message you just typed.",
  continue: "Continue your conversation",
  startNewHeading: GUEST_NEW_CONVERSATION.confirmHeading,
  startNew: GUEST_NEW_CONVERSATION.confirm,
  reassurance: GUEST_NEW_CONVERSATION.unknown,
  failed: "The concierge could not answer just now. Your message is kept below; send it again.",
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
    GUEST_PAYMENT_COPY.lateReview,
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

/**
 * Issue 09 (ADR 0080, 0077): the question asked before a search moves to a different area. The deterministic concierge
 * (`mergeStayRequestContext`) and the assistant's shortlet pack read this one sentence, so both paths ask the same question.
 */
export const GUEST_LOCATION_CONFLICT = Object.freeze({
  question: (wanted: string, incumbent: string): string => `Do you want ${wanted}, or should I keep searching in ${incumbent}?`,
});

/**
 * ADR-0005, 0060, 0080 (issue 12): why a sent stay cannot change, and what the guest can do instead. The deterministic concierge
 * (`#changeExplanation`) and the assistant's shortlet pack read these same strings, so both paths give one reply.
 */
export const GUEST_CHANGE_EXPLANATION = Object.freeze({
  request: (operatorName: string | undefined): string => {
    const operator = guestOperatorName(operatorName);
    return `A sent ${GUEST_GLOSSARY.bookingRequest} can't be changed while ${operator} reviews it. If ${operator} confirms, you can choose not to accept the offer at no cost and search again with new details. Nothing has been changed.`;
  },
  offer: (): string => `A ${GUEST_GLOSSARY.conditionalBookingOffer} can't be changed. You can choose not to accept it at no cost and search again with new details. Nothing has been changed.`,
  payment: (): string => "An accepted offer can't be changed from this conversation. Nothing has been changed.",
  booking: (): string => `Changes to a confirmed ${GUEST_GLOSSARY.reservation} are made as a booking amendment, which re-checks availability and price. I can't start one from this conversation yet. Nothing has been changed.`,
});

/**
 * Issue 11 (ADR 0080, 0075, 0077): the answer to a facility question on the selected stay. Both the deterministic concierge
 * (`#stageReply`) and the assistant's shortlet pack read these sentences. The amenity name and the stay title come from the
 * server's own records, never from guest text (ADR 0075).
 */
export const GUEST_FACILITY_COPY = Object.freeze({
  listed: (title: string, amenityLabel: string): string => `Yes: ${title} lists ${amenityLabel}.`,
  notListed: (title: string, facilityLabel: string): string => `${facilityLabel} isn't listed for ${title}, so I can't confirm it.`,
});

/** Issue 11: the stages a sent stay can be in, for the stage reply. `current` covers every stage before a request is sent. */
export type GuestCapabilityStage = "request" | "offer" | "payment" | "booking" | "current";

/**
 * Issue 11 (ADR 0005, 0060, 0080, 0077): what the guest can do at each stage, with the stay named when there is one. The deterministic
 * concierge (`#capabilityReply`) and the assistant's shortlet pack read this one function, so a vague turn gets the same reply on both paths.
 */
export function guestCapabilityReply(stage: GuestCapabilityStage, unit?: { readonly title: string; readonly operatorName?: string | undefined }): string {
  const about = unit === undefined ? "" : ` I can also answer questions about ${unit.title}, such as parking or Wi-Fi.`;
  if (stage === "request")
    return `Your ${GUEST_GLOSSARY.bookingRequest} is with ${guestOperatorName(unit?.operatorName)} for review; the details are in the workspace.${about}`;
  if (stage === "offer")
    return `Your ${GUEST_GLOSSARY.conditionalBookingOffer} is in the workspace. Review it and accept it there if it suits you.${about}`;
  if (stage === "payment")
    return `Your payment step is in the workspace.${about}`;
  if (stage === "booking")
    return `Your booking details are in the workspace.${about}`;
  return `Your current details are in the workspace.${about}`;
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
  // ADR 0044/0077: the deadline banner already carries the one authoritative WAT timestamp.
  const window = /^Payment must be completed within the (\d+)-minute Payment Window expiring at \S+\.$/.exec(text.trim());
  if (window) return `Complete payment within the ${window[1]}-minute Payment Window shown above.`;
  // ADR 0085: pilot identity verification controls access, not offer acceptance or payment.
  if (text.trim() === "Primary guest identity verification and stay occupancy rules apply strictly to this booking offer.")
    return "Guest identity verification is required before access. The Primary Guest must follow the disclosed occupancy rules.";
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

/**
 * The closed amenity catalogue (issue 08): the identifiers the guest product labels. The assistant's amenity schema and the
 * concierge's alias table both read this list, so no second catalogue exists.
 */
export const GUEST_AMENITY_IDS: readonly string[] = Object.freeze(Object.keys(AMENITY_LABELS));

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
  /** ADR 0105: the chip on every synthetic stay in the staging demo (stay cards and the unit detail). */
  demoListing: "Demo listing",
  /** Demo-launch issue 12: the Extended Stay's monthly price, one Billing Period's guest amount (ADR 0092). */
  monthlyPrice: "Monthly price",
  /** Demo-launch issue 12: the utilities and servicing statement the unit publishes (ADR 0092). */
  utilitiesIncluded: "Utilities and servicing",
  /** Demo-launch issue 12: the payment schedule heading and each period's label (CONTEXT.md term). */
  paymentSchedule: "Payment schedule",
  billingPeriod: "Billing Period",
  /** Demo-launch issue 12: says the amount due now is the first Billing Period, not the whole stay (ADR 0092). */
  firstPeriodOnly: "This is the first Billing Period only. Later Billing Periods are paid separately on their due dates.",
});

/**
 * ADR 0105: the staging demo's visitor copy. Only the demo banner and the test-payment copy live here; the landing page
 * keeps its own demo notice in landing-copy.ts. Nothing in this table is a live policy term.
 */
const GUEST_DEMO_NOTICE = "Demo: illustrative listings, not live bookings.";
const GUEST_DEMO_TEST_PAYMENTS = "Payments use Paystack test mode with the published test card. Do not enter real personal data.";
export const GUEST_DEMO_COPY = Object.freeze({
  notice: GUEST_DEMO_NOTICE,
  testPayments: GUEST_DEMO_TEST_PAYMENTS,
  /** The banner every guest page carries in demo mode. */
  banner: `${GUEST_DEMO_NOTICE} ${GUEST_DEMO_TEST_PAYMENTS}`,
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

/**
 * Guest Account sign-in copy (issue 06). Plain, functional wording only: the final marketing copy is awaiting human
 * approval (see the issue's Comments). Each error carries the reason code its page exposes as `data-error-code`.
 */
export const GUEST_ACCOUNT_COPY = Object.freeze({
  signInTitle: "Sign in",
  signInIntro: "We'll email you a six-digit code. Enter it here to sign in on this device.",
  emailLabel: "Email address",
  sendCode: "Send code",
  codeTitle: "Enter your code",
  codeIntro: "We sent a six-digit code to the email address you gave. It expires soon.",
  codeLabel: "Six-digit code",
  checkCode: "Check code",
  requestNewCode: "Request a new code",
  signedIn: "Signed in",
  signedInIntro: "You are signed in on this device.",
  signOut: "Sign out",
  signOutEverywhere: "Sign out everywhere",
  signOutEverywhereIntro: "This signs out every device on your account. Open conversations on those devices stop working.",
  appBarSignIn: "Sign in",
  appBarAccount: "Account",
  offerNotFoundTitle: "We could not find that payment link",
  offerNotFoundMessage: "This link does not open here. Sign in with the account that made this booking, or return to your conversation.",
  rateLimitedTitle: "Please slow down",
  rateLimitedMessage: "Too many requests came from here in a short time. Wait a few minutes, then try again.",
  emailSubject: "Your Shortlet sign-in code",
  emailBody: (code: string, minutes: number): string =>
    `Your Shortlet sign-in code is ${code}. It expires in ${minutes} minutes. If you did not ask for this code, you can ignore this email.`,
  unavailable: "Sign-in is not available right now. You can keep searching and booking without signing in.",
  signInRequired: "Sign in to see your account.",
  // Issue 08 sign-in offer after a request is sent and after a booking is confirmed. Functional wording, not final: awaiting human approval (Needs human: copy approval).
  offerTitle: "Sign in to see this booking on your other devices",
  offerIntro: "We will email you a six-digit code. Signing in is optional, and your booking stays as it is.",
  offerButton: "Send me a code",
  // Issue 07 account page. Functional wording, not final: awaiting human approval with the rest of this block.
  accountTitle: "Your account",
  brandName: "Shortlet",
  brandEyebrow: "Shortlet",
  backToConversation: "Back to your conversation",
  tryAgain: "Try again",
  backToAccount: "Back to your account",
  codeExpiresIn: (minutes: number): string => `It expires in ${minutes} minutes.`,
  accountIntro: "Check your details, change your email or phone, and manage where you are signed in.",
  detailsHeading: "Your details",
  phoneLabel: "Phone number",
  phoneHint: "We save this number for your bookings. We do not check it yet.",
  phoneNotAdded: "No phone added yet",
  savePhone: "Save phone number",
  identityLabel: "Identity status",
  identityEmailConfirmed: "Email confirmed",
  identityIdChecked: "ID checked",
  identityIdNotChecked: "ID not checked yet – we'll do this before check-in",
  changeEmailHeading: "Change email",
  changeEmailIntro: "We will send a code to the new address. Your email changes only after you enter that code.",
  changeEmailButton: "Send code to new email",
  changeEmailCodeTitle: "Confirm your new email",
  changeEmailCodeIntro: "We sent a six-digit code to the new address. Enter it to change your account email.",
  changeEmailCheckButton: "Confirm new email",
  emailChangeSubject: "Confirm your new Shortlet email",
  emailChangeBody: (code: string, minutes: number): string =>
    `Your Shortlet code to confirm this email address is ${code}. It expires in ${minutes} minutes. If you did not ask for this change, you can ignore this email.`,
  emailChangedNotice: "Your account email has been changed.",
  phoneSavedNotice: "Your phone number has been saved.",
  sessionsHeading: "Where you are signed in",
  errors: Object.freeze({
    sameEmail: "That is already your account email.",
    emailInUse: "That email address belongs to another account. Use a different address.",
    emailOwnedByAccount: "Your contact email is your account email. Change it on your account page.",
    phoneSaveFailed: "Your phone number could not be saved. Try again.",
    invalidEmail: "Enter a valid email address.",
    codeInvalid: "That code is not right. Check the email and try again.",
    codeExpired: "That code has expired. Request a new code.",
    attemptsExhausted: "Too many wrong attempts. Request a new code.",
    codeConsumed: "That code has already been used. Request a new code.",
    sendFailed: "We could not send the code. Try again in a few minutes.",
    linkConflict: "This browser is already linked to a different account. Sign out there first.",
  }),
});

/** Commerce guest copy for the store, offer and order-tracking pages (ADR 0077: chat and pages share these strings). */
export const COMMERCE_GUEST_COPY = Object.freeze({
  soldBy: "Sold by",
  verifiedStore: "Verified store",
  viewOffer: "View offer",
  available: "available",
  storeUnavailableTitle: "Store unavailable",
  storeUnavailableBody: "This store could not be found.",
  offerUnavailableTitle: "Offer unavailable",
  offerUnavailableBody: "This offer is not available.",
  noOffersTitle: "No offers available",
  noOffersBody: "This store has no offers to show right now.",
  trackOrderLink: "Track an order",
  trackOrderTitle: "Track your order",
  trackOrderIntro: "Enter the public code and the phone number used for the order. We use both to protect your order details.",
  publicCodeLabel: "Public order code",
  phoneLabel: "Phone number used for the order",
  phoneHint: "Only used to verify this order.",
  trackOrderSubmit: "Track order",
  orderNotFound: "We could not find an order with those details. Check the code and phone number and try again.",
  orderLookupFailed: "We could not check the order right now. Please try again.",
  orderStatusTitle: "Order status",
  publicCodeHeading: "Public code",
  statusHeading: "Status",
  lastUpdatedHeading: "Last updated",
  trackAnotherOrder: "Track another order",
  continueInChatLink: "Continue in chat for cart and checkout",
  continueInChatButton: "Continue in chat",
  cartTitle: "Your store cart",
  cartBody: "Continue in the Shop chat to manage your cart and proceed to checkout.",
  cartPageTitle: "Shopping cart",
  pageTitleSuffix: "Shop",
});

/** The one "Sold by" line: the Merchant (seller of record, ADR 0001), with the Store when a card or chat row names it. */
export function commerceSoldBy(merchantName: string, storeName?: string): string {
  return storeName === undefined ? `${COMMERCE_GUEST_COPY.soldBy} ${merchantName}` : `${COMMERCE_GUEST_COPY.soldBy} ${merchantName} · ${storeName}`;
}

/** Shared request-contact guidance (guest-focused journey issue 03). */
export const GUEST_PHONE_COPY = {
  help: "Required before you send a Booking Request. Enter a Nigerian mobile number, such as 0801 234 5678 or +234 801 234 5678. This is for booking coordination, not identity verification.",
  invalid: "Enter a Nigerian mobile number, such as 0801 234 5678.",
} as const;

export const GUEST_REQUEST_EDIT_COPY = {
  heading: "Edit your request",
  dates: "Edit dates",
  guests: "Edit guests",
  guestCount: "Number of guests",
  save: "Save and review",
  phone: "Edit phone number",
  invalid: "Check your dates and number of guests.",
  stale: "Use the current Request Draft.",
} as const;

/** Guest-focused issue 04: wording is separate from payment/refund authority. */
export const GUEST_PAYMENT_COPY = {
  accept: "Accept and choose payment",
  accepted: "Choose how to pay. Your booking confirms only after payment is verified.",
  cancellation: "Cancellation",
  conduct: "Guest conduct",
  otherTerms: "Other booking terms",
  card: "Card",
  cardHelp: "Hosted card checkout. Do not start another payment while this attempt is pending.",
  transfer: "Bank transfer",
  transferHelp: "If you choose bank transfer, you can't switch to card until the transfer account expires.",
  manual: "Manual bank transfer",
  manualHelp: "Pay our business account and upload your receipt. Your booking confirms only after we check the money has arrived. You can't switch until this attempt expires or is declined.",
  lateReview: "A late payment needs review and does not confirm your booking. Contact Shortlet if you sent money after the deadline.",
} as const;

/**
 * Monthly-stays issue 17 (ADR 0092, ADR 0077): the Notice to End copy, one source for the chat workspace and the standalone
 * page. The action, heading, confirm and back labels were proposed in the issue and are awaiting owner confirmation (Comments).
 */
export const GUEST_NOTICE_COPY = Object.freeze({
  action: "Give notice to end your stay",
  heading: "End your stay early",
  confirm: "Give notice",
  back: "Keep my stay",
  recordedBack: "Back to my stay",
  /** Issue 18 (proposed for owner confirmation, 8 Nov 2026): refusals and the typed-confirmation reply. */
  notExtended: "Giving notice applies to an Extended Stay. This is a Short Stay, so it cannot be ended early from here.",
  notVerified: "You can give notice once you have checked in at the property.",
  unavailable: "Notice to End is not available for this stay right now.",
  cardOpened: "Here are the terms for giving notice. Press Give notice on the card to confirm.",
  given: "Notice given. Your stay now ends on the new last night.",
  stale: "The notice terms have changed. Ask again to see the current terms.",
  newLastNight: "New last night",
  newCheckOut: "New checkout",
  refund: "Refund for paid nights after it",
  owed: "Still owed up to it",
  recordedHeading: "Notice given",
  recordedLead: "Your stay now ends on the new last night below. Refunds are paid by hand, as the terms say.",
});

/**
 * Monthly-stays issue 09 (ADR 0092 Extensions). Labels "Extend your stay" and "Request extension" are proposed for owner
 * confirmation (8 Nov 2026); every other string here is new and listed in the issue's Comments for the owner.
 */
export const GUEST_EXTENSION_COPY = Object.freeze({
  action: "Extend your stay",
  heading: "Extend your stay",
  confirm: "Request extension",
  back: "Not now",
  /** Refusals (a guest refusal, never an error): the reason names the one thing that stops the extension. */
  notExtended: "Extending applies to an Extended Stay. A Short Stay cannot be extended to 30 nights or more from here.",
  noticeInForce: "A Notice to End is in force, so this stay cannot be extended.",
  pending: "An extension request is already waiting for the Operator.",
  unavailable: "The unit is not available for every added night, so the stay cannot be extended.",
  inspection: "The inspection or Management Authority does not cover the new checkout, so the stay cannot be extended.",
  tooLong: "An Extended Stay is at most 180 nights in total, so the stay cannot be extended further.",
  notAvailable: "This stay cannot be extended right now.",
  cardOpened: "Here is the extension and what it adds. Press Request extension on the card to send it to the Operator. Nothing is agreed until the Operator approves.",
  requested: "Extension requested. The Operator will reply by the time shown below. Nothing is added until they approve.",
  approved: "Extension agreed. Your stay now ends on the new checkout.",
  declined: "The Operator could not extend your stay. Nothing has changed.",
  expired: "The Operator did not reply in time, so the extension was not made. Nothing has changed.",
  stale: "The extension terms have changed. Ask again to see the current terms.",
  addedNights: "Added nights",
  newCheckOut: "New checkout",
  addedAmount: "Added amount (paid as each period falls due)",
  dueDate: "Due date for the added period",
  respondBy: "Operator replies by",
});

export interface ExtensionFactsInput {
  readonly addedNights: number;
  readonly newCheckOut: string;
  readonly addedAmountKobo: number;
  /** The added period's due date: its Period Payment falls due 7 days before its first night (ADR 0092). */
  readonly periodDueDate: string;
}

export interface ExtensionFactRow {
  readonly key: "addedNights" | "newCheckOut" | "addedAmount" | "dueDate" | "respondBy";
  readonly label: string;
  readonly value: string;
  readonly raw: string;
}

/** The extension facts in one order for the page and the chat card (ADR 0077, 0080). `money` formats kobo for the surface. */
export function extensionFactRows(facts: ExtensionFactsInput, money: (kobo: number) => string, respondBy?: string): readonly ExtensionFactRow[] {
  return [
    { key: "addedNights", label: GUEST_EXTENSION_COPY.addedNights, value: `${facts.addedNights} ${facts.addedNights === 1 ? "night" : "nights"}`, raw: String(facts.addedNights) },
    { key: "newCheckOut", label: GUEST_EXTENSION_COPY.newCheckOut, value: formatGuestDate(facts.newCheckOut) ?? facts.newCheckOut, raw: facts.newCheckOut },
    { key: "addedAmount", label: GUEST_EXTENSION_COPY.addedAmount, value: money(facts.addedAmountKobo), raw: String(facts.addedAmountKobo) },
    { key: "dueDate", label: GUEST_EXTENSION_COPY.dueDate, value: formatGuestDate(facts.periodDueDate) ?? facts.periodDueDate, raw: facts.periodDueDate },
    ...(respondBy === undefined ? [] : [{ key: "respondBy" as const, label: GUEST_EXTENSION_COPY.respondBy, value: respondBy, raw: respondBy }]),
  ];
}

/** The Notice to End facts as the domain calculated them (issue 18 AC1): one helper for the page and the chat card. */
export interface NoticeFactsInput {
  readonly newLastNight: string;
  readonly newCheckOut: string;
  readonly refundKobo: number;
  readonly owedKobo: number;
}

/** One fact row: its copy label, the value shown, and the raw value a test or a hook reads. */
export interface NoticeFactRow {
  readonly key: "newLastNight" | "newCheckOut" | "refund" | "owed";
  readonly label: string;
  readonly value: string;
  readonly raw: string;
}

/** The four facts in the issue 17 order. `money` formats kobo for the surface that shows them. */
export function noticeFactRows(facts: NoticeFactsInput, money: (kobo: number) => string): readonly NoticeFactRow[] {
  return [
    { key: "newLastNight", label: GUEST_NOTICE_COPY.newLastNight, value: formatGuestDate(facts.newLastNight) ?? facts.newLastNight, raw: facts.newLastNight },
    { key: "newCheckOut", label: GUEST_NOTICE_COPY.newCheckOut, value: formatGuestDate(facts.newCheckOut) ?? facts.newCheckOut, raw: facts.newCheckOut },
    { key: "refund", label: GUEST_NOTICE_COPY.refund, value: money(facts.refundKobo), raw: String(facts.refundKobo) },
    { key: "owed", label: GUEST_NOTICE_COPY.owed, value: money(facts.owedKobo), raw: String(facts.owedKobo) },
  ];
}
