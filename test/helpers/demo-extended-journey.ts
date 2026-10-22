/**
 * Shared composition for the staging demo Extended Stay tests (demo-launch issues 08 and 09, ADR 0092 and ADR 0105).
 * Every value is synthetic: the Unit, operator and guest are seeded fixtures, and Paystack is a stubbed TEST fetcher.
 */
import { UnitRepository, seedIssue01Units } from "../../domains/shortlet/src/index.js";
import type { Unit } from "../../domains/shortlet/src/browse.js";
import { unitPriceFromOwnerTerms } from "../../domains/shortlet/src/owner-terms.js";
import type { MonthlyAgreedAmounts, UtilitiesAndServicingStatement } from "../../domains/shortlet/src/extended-stay.js";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/local-owner-environment.js";
import { createDemoRequestAcceptor } from "../../apps/local-owner/src/demo-operator-acceptance.js";
import type { PaymentOutcome } from "../../packages/platform-core/src/payments/payments.js";
import { DirectPaystackClient, PaystackPayments, type PaystackHttpFetcher } from "../../packages/platform-core/src/payments/index.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { demoDatabase, removeDemoDatabase } from "./demo-mode-fixture.js";

export const SYNTHETIC_NOW = new Date("2026-09-03T10:00:00.000Z");

export const DEFAULT_MONTHLY: MonthlyAgreedAmounts = Object.freeze({ accommodationKobo: 10_000_000, mandatoryChargesKobo: 500_000, version: "monthly-v1" });
export const DEFAULT_UTILITIES: UtilitiesAndServicingStatement = Object.freeze({
  powerAndGeneratorFuelIncluded: true,
  waterIncluded: true,
  internetIncluded: true,
  cleaningIncluded: true,
  cleaningFrequency: "weekly" as const,
});

/** Adds calendar days to a YYYY-MM-DD date, in UTC, as Lagos calendar dates are compared. */
export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The issue 08 Unit with opted-in monthly terms and the seeded claims (valid through 2027-01-15 at the latest). */
/** A Unit whose monthly and utilities terms are present, for tests that read them without guards. */
export type OptedInUnit = Unit & { readonly extendedStay: { readonly optedIn: true; readonly monthlyAgreedAmounts: MonthlyAgreedAmounts; readonly utilitiesAndServicing: UtilitiesAndServicingStatement } };

export function optedInUnit(): OptedInUnit {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findAll()[0]!;
  return {
    ...unit,
    extendedStay: { optedIn: true, monthlyAgreedAmounts: { ...DEFAULT_MONTHLY }, utilitiesAndServicing: { ...DEFAULT_UTILITIES } },
  } as OptedInUnit;
}

export interface ExtendedUnitOptions {
  readonly ownerNightlyKobo?: number;
  readonly ownerMandatoryChargesKobo?: number;
  readonly marginBasisPoints?: number;
  readonly monthly?: MonthlyAgreedAmounts;
  readonly utilities?: UtilitiesAndServicingStatement;
  readonly extendedStay?: Unit["extendedStay"];
  readonly taxConfig?: unknown;
  /** Every inspection, authority, licence, insurance and operator-approval claim expires on this date. */
  readonly claimsThrough?: string;
}

/** The issue 01 Unit, used by standalone discovery and quote tests. */
function issue01Unit(): Unit {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return repository.findAll()[0]!;
}

/**
 * An Extended Stay Unit whose price derives from owner terms (ADR 0089), whose monthly terms are opted in (ADR 0092),
 * and whose claims cover a checkout date chosen by the test. Standalone quote and discovery tests start from the
 * issue 01 Unit; journey tests use `extendUnit` on the demo's seeded Unit so the operator and property still match.
 */
export function extendedStayUnit(options: ExtendedUnitOptions = {}): Unit {
  return extendUnit(issue01Unit(), options);
}

/** Applies Extended Stay terms, derived owner pricing and claims that cover the test's checkout onto a base Unit. */
export function extendUnit(seeded: Unit, options: ExtendedUnitOptions = {}): Unit {
  const claims = options.claimsThrough ?? "2028-06-30";
  const price = unitPriceFromOwnerTerms({
    ownerNightlyKobo: options.ownerNightlyKobo ?? 7_083_334,
    ownerMandatoryChargesKobo: options.ownerMandatoryChargesKobo ?? 833_334,
    marginBasisPoints: options.marginBasisPoints ?? 2000,
    refundableSecurityDepositKobo: 2_000_000,
    version: "price-1",
  });
  const priceWithTax = options.taxConfig === undefined ? price : { ...price, taxConfig: options.taxConfig };
  return {
    ...seeded,
    price: priceWithTax as Unit["price"],
    operator: { ...seeded.operator, approvalExpiresAt: claims },
    inspection: { ...seeded.inspection, expiresAt: claims },
    managementAuthority: { ...seeded.managementAuthority, expiresAt: claims },
    regulatory: {
      licensing: { ...seeded.regulatory.licensing, expiresAt: claims },
      insurance: { ...seeded.regulatory.insurance, expiresAt: claims },
    },
    extendedStay: options.extendedStay ?? {
      optedIn: true,
      monthlyAgreedAmounts: options.monthly ?? { ...DEFAULT_MONTHLY },
      utilitiesAndServicing: options.utilities ?? { ...DEFAULT_UTILITIES },
    },
  };
}

export interface DemoGuestContext {
  readonly guest: LocalGuestEnvironment;
  readonly owner: LocalApartmentOwnerEnvironment;
  readonly unitId: string;
  readonly clock: () => Date;
  /** The synthetic clock value, read and moved by tests that check time-bound state. */
  readonly nowRef: { now: number };
  /** Moves the synthetic clock so eligibility is rechecked at a later point in the journey. */
  readonly setClock: (iso: string) => void;
  /** The synthetic demo database file, so a test can reopen the authoritative store (restart tests, issue 10). */
  readonly databasePath: string;
}

export interface DemoGuestOptions {
  /** Replaces the seeded demo Unit before any request is made; a function receives that seeded Unit. */
  readonly unit?: Unit | ((seeded: Unit) => Unit);
  readonly outcomeFactory?: (reference: string, amount: number, payerId: string) => PaymentOutcome;
  readonly offsetClock?: { now: number };
}

/** A staging demo guest with a stubbed Paystack TEST provider and the real SQLite stores (ADR 0095, ADR 0105). */
export async function withDemoGuest(options: DemoGuestOptions, run: (context: DemoGuestContext) => Promise<void> | void): Promise<void> {
  const files = demoDatabase();
  const nowRef = options.offsetClock ?? { now: SYNTHETIC_NOW.getTime() };
  const clock = () => new Date(nowRef.now);
  const database = openNodeSqliteDatabase(files.path);
  const unitRepository = new UnitRepository();
  const owner = new LocalApartmentOwnerEnvironment({ databasePath: files.path, clock, production: true, demo: true, deployment: "staging", seedFixture: false }, { database, unitRepository, operatorRepository: null });
  let currentAmount = 0;
  let currentPayer = "";
  const paystackFetcher: PaystackHttpFetcher = async (url, init) => {
    if (init.method === "POST") {
      const payloadValue: unknown = JSON.parse(init.body ?? "{}");
      if (payloadValue === null || typeof payloadValue !== "object") throw new Error("invalid synthetic request");
      const payload = payloadValue as Record<string, unknown>;
      currentAmount = typeof payload.amount === "number" ? payload.amount : 0;
      const metadataValue: unknown = typeof payload.metadata === "string" ? JSON.parse(payload.metadata) : {};
      const metadata = metadataValue !== null && typeof metadataValue === "object" ? metadataValue as Record<string, unknown> : {};
      currentPayer = typeof metadata.shortlet_guest_id === "string" ? metadata.shortlet_guest_id : "";
      return { status: 200, async json() { return { status: true, data: { authorization_url: "https://checkout.paystack.com/synthetic", reference: payload.reference } }; } };
    }
    const reference = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    const result = options.outcomeFactory?.(reference, currentAmount, currentPayer) ?? { reference, method: "card" as const, verified: true, status: "success" as const, amountKobo: currentAmount, currency: "NGN", providerReference: reference, payerId: currentPayer, environment: "test" as const };
    return { status: 200, async json() { return { status: true, data: { reference: result.providerReference, amount: result.amountKobo, currency: result.currency, status: result.status, domain: "test", metadata: { shortlet_guest_id: result.payerId } } }; } };
  };
  const paystack = new PaystackPayments({ card: new DirectPaystackClient({ secretKey: "sk_test_synthetic_fixture", environment: "test", callbackBaseUrl: "https://demo.example.test" }, paystackFetcher) });
  const guest = new LocalGuestEnvironment({ databasePath: files.path, clock, production: true, demo: true, deployment: "staging", payments: paystack, demoRequestAcceptor: createDemoRequestAcceptor(owner, 0) }, { database, unitRepository, seedDemoUnits: true });
  try {
    const seeded = guest.unitRepository.findAll()[0]!;
    const target = typeof options.unit === "function"
      ? options.unit(seeded)
      : options.unit ?? { ...seeded, extendedStay: optedInUnit().extendedStay };
    guest.unitRepository.save(target);
    await run({
      guest, owner, unitId: target.id, clock, nowRef,
      setClock: (iso: string) => { nowRef.now = Date.parse(iso); },
      databasePath: files.path,
    });
  } finally {
    guest.close();
    owner.close();
    database.close();
    removeDemoDatabase(files.dir);
  }
}

/** Creates a Booking Request draft through the real guest application. Throws when the stay is refused. */
export function createDemoDraft(context: DemoGuestContext, stay: { readonly checkIn: string; readonly checkOut: string }) {
  const { guest, unitId } = context;
  return guest.bookingRequestApp.createDraft({
    unitId,
    primaryGuest: { id: guest.config.guestId, name: guest.config.guestName },
    occupants: guest.demoOccupants(1),
    selfBookingAttestation: guest.selfBookingAttestation(),
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  }, guest.guestPrincipal());
}

/** Discloses a draft to the operator and returns its Request id. Throws when the request is refused. */
export function discloseDemoDraft(context: DemoGuestContext, draftId: string): string {
  return context.guest.bookingRequestApp.disclose(draftId, context.guest.guestPrincipal()).requestId;
}

/** Operator confirmation: the Request becomes an offer (the demo acceptor confirms it through the real command path). */
export function offerFromDemoRequest(context: DemoGuestContext, requestId: string): string {
  return context.guest.acceptDisclosedRequest(requestId).offerId;
}

/** The Guest accepts the offer, which starts the Payment Window. Throws when the offer is no longer valid. */
export function acceptDemoOffer(context: DemoGuestContext, offerId: string): void {
  const { guest } = context;
  const offer = guest.conditionalOfferApp.getOffer(offerId);
  guest.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: guest.guestPrincipal() });
}

export interface DemoJourneyOptions extends DemoGuestOptions {
  readonly checkIn?: string;
  readonly checkOut?: string;
  readonly beforeOffer?: (input: DemoGuestContext & { readonly requestId: string }) => void;
  readonly beforeAcceptance?: (input: DemoGuestContext & { readonly offerId: string }) => void;
  readonly beforeCheckout?: (input: DemoGuestContext & { readonly offerId: string }) => void;
  readonly afterCheckout?: (input: DemoGuestContext & { readonly offerId: string; readonly session: { readonly checkoutId: string; readonly expiresAt: string; readonly amountKobo: number } }) => void;
}

export interface DemoJourneyContext extends DemoGuestContext {
  readonly requestId: string;
  readonly offerId: string;
}

/** Runs the real request, disclosure, offer, acceptance and Paystack TEST checkout path for one stay. */
export async function withDemoExtendedJourney(options: DemoJourneyOptions, run: (context: DemoJourneyContext) => Promise<void> | void): Promise<void> {
  await withDemoGuest(options, async (context) => {
    const draft = createDemoDraft(context, { checkIn: options.checkIn ?? "2026-09-10", checkOut: options.checkOut ?? "2026-10-10" });
    const requestId = discloseDemoDraft(context, draft.draftId);
    options.beforeOffer?.({ ...context, requestId });
    const offerId = offerFromDemoRequest(context, requestId);
    options.beforeAcceptance?.({ ...context, offerId });
    acceptDemoOffer(context, offerId);
    options.beforeCheckout?.({ ...context, offerId });
    const session = await context.guest.cardPaymentApp.initializePaystackCheckout(offerId, context.guest.guestPrincipal());
    options.afterCheckout?.({ ...context, offerId, session });
    await run({ ...context, requestId, offerId });
  });
}
