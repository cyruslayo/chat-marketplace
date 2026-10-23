import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SELF, abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createProvisionedOperator } from "../../../domains/shortlet/src/operator.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment } from "../../local-owner/src/local-owner-environment.js";
import { createDemoRequestAcceptor } from "../../local-owner/src/demo-operator-acceptance.js";
import { opsStub, accessToken, opsHeaders } from "./ops-test-helpers.js";
import type { CloudflareEnv } from "../src/cloudflare-config.js";
import { SqliteGuestInteractionStore } from "../../../domains/shortlet/src/guest-interaction-store.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

const START = new Date("2026-09-03T10:00:00.000Z");
const ORIGIN = "https://pilot.example.test";

// Demo-launch issue 12 (batch-gate fix): Operator Active Hours (08:00-19:30 WAT for disclosure) read the wall clock.
// The spec fixes the clock at START (11:00 WAT), inside those hours, so it passes at any time of day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
});

function demoWorkerFetch(tenantId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-shortlet-demo-test", "enabled");
  headers.set("x-shortlet-demo-tenant", tenantId);
  const request = new Request(new URL(path, ORIGIN), { redirect: "manual", ...init, headers });
  return SELF.fetch(request);
}

test("AC6: the Durable Object SQLite composition preserves the 30-night journey across runtime restart", async () => {
  await runInDurableObject(opsStub(), async (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const units = new SqliteUnitRepository(database);
    const clock = () => START;
    const owner = new LocalApartmentOwnerEnvironment({ tenantId: "tenant-do-demo", demo: true, deployment: "staging", clock }, { database, unitRepository: units, operatorRepository: new SqliteOperatorRepository(database, { clock }) });
    const unit = units.findById("unit-lagos-ikoyi-001")!;
    units.save({
      ...unit,
      extendedStay: {
        optedIn: true,
        monthlyAgreedAmounts: { accommodationKobo: 15_000_000, mandatoryChargesKobo: 500_000, version: "do-monthly-v1" },
        utilitiesAndServicing: { powerAndGeneratorFuelIncluded: true, waterIncluded: true, internetIncluded: true, cleaningIncluded: true, cleaningFrequency: "weekly" },
      },
    });
    const config = {
      tenantId: "tenant-do-demo",
      operatorId: unit.operator.id,
      operatorName: unit.operator.name,
      representativePersonId: "demo-operator-representative",
      representativePersonName: "Demo Operator",
      adminId: "demo-admin",
      guestId: "guest-do-demo",
      guestName: "Synthetic Guest",
      initialGuestPhoneNumber: "+2348012345678",
      initialGuestContactEmail: "guest@example.test",
      demo: true,
      demoRequestAcceptor: createDemoRequestAcceptor(owner, 0),
      clock,
    } as const;
    const firstRuntime = new LocalGuestEnvironment(config, { database, unitRepository: units });
    try {
      const draft = firstRuntime.bookingRequestApp.createDraft({
        unitId: unit.id,
        primaryGuest: { id: config.guestId, name: config.guestName },
        occupants: firstRuntime.demoOccupants(1),
        selfBookingAttestation: firstRuntime.selfBookingAttestation(),
        checkIn: "2026-09-10",
        checkOut: "2026-10-10",
      }, firstRuntime.guestPrincipal());
      const requestId = firstRuntime.bookingRequestApp.disclose(draft.draftId, firstRuntime.guestPrincipal()).requestId;
      const { offerId } = firstRuntime.acceptDisclosedRequest(requestId);
      const offer = firstRuntime.conditionalOfferApp.getOffer(offerId);
      firstRuntime.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: firstRuntime.guestPrincipal() });
      const checkout = firstRuntime.cardPaymentApp.initializeCheckout(offerId, firstRuntime.guestPrincipal());
      expect(checkout.amountKobo).toBeGreaterThan(0);
    } finally {
      firstRuntime.close();
    }
    const restarted = new LocalGuestEnvironment(config, { database, unitRepository: new SqliteUnitRepository(database) });
    try {
      expect(restarted.unitRepository.findById(unit.id)?.extendedStay?.monthlyAgreedAmounts?.version).toBe("do-monthly-v1");
      const request = restarted.bookingRequestApp.getRequest(restarted.interactionStore.listBookingRequestIds()[0]!);
      expect(request.quote.stayType).toBe("extended");
      expect(request.quote.billingPeriods).toHaveLength(1);
      const offerId = restarted.interactionStore.findConditionalOfferByRequestId(request.requestId)!.offerId;
      expect(restarted.conditionalOfferApp.getOffer(offerId).status).toBe("accepted");
      const checkout = restarted.cardPaymentApp.getCheckoutSession(offerId)!;
      const confirmed = restarted.cardPaymentApp.verifyAndConfirm(checkout.pspReference, { id: "demo-payment-verifier", role: "system", tenantId: config.tenantId });
      expect(confirmed.outcome).toBe("confirmed");
      if (confirmed.outcome === "confirmed") expect(confirmed.bookingContract.dates.nights).toBe(30);
    } finally {
      restarted.close();
      owner.close();
    }
  });
});

test("AC6: the demo Worker imports, requests, pays, and confirms a 30-night stay after a Durable Object restart", async () => {
  const tenant = `demo-extended-${crypto.randomUUID()}`;
  const stub = (env as unknown as { readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"] }).DEMO_SHORTLET.get((env as unknown as { readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"] }).DEMO_SHORTLET.idFromName(tenant));
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const date = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const checkIn = date(7);
  const checkOut = date(37);
  const verified = date(-1);
  const expires = date(365);
  const operatorId = `demo-operator-${tenant}`;
  const operator = {
    ...createProvisionedOperator({ id: operatorId, tenantId: tenant, name: "Synthetic Demo Operator", now }),
    status: "approved",
    legalForm: "private-company-limited-by-shares",
    cacVerified: true,
    responsiblePersonsVerified: true,
    beneficialOwnersVerified: true,
    paymentProviderApproved: true,
    settlementAccountVerified: true,
    approvedAt: verified,
    approvalExpiresAt: expires,
  };
  await runInDurableObject(stub, (_instance, ctx) => {
    const repository = new SqliteOperatorRepository(new DurableObjectSqlDatabase(ctx.storage), { clock: () => now });
    if (!repository.findById(operatorId)) repository.create(operator);
  });

  const headers = await accessToken({});
  const values: Record<string, string> = {
    external_listing_id: `demo-${tenant}`, unit_id: `demo-unit-${tenant}`, property_id: `demo-property-${tenant}`, operator_id: operatorId,
    title: "Synthetic demo apartment", city: "Lagos", neighbourhood: "Old Ikoyi", capacity: "2", bedrooms: "1",
    owner_nightly_ngn: "100000", owner_mandatory_charges_ngn: "0", margin_percent: "15", refundable_security_deposit_ngn: "0", currency: "NGN", amenities: "wifi",
    inspection_status: "passed", inspection_date: verified, inspection_expiry: expires,
    inspection_scope: "entire-place-possession|structure-and-sanitation|fire-and-emergency-readiness|electrical-and-utilities|locks-and-privacy|access-controls|cameras|listing-accuracy|current-media",
    inspection_material_change_pending: "false", management_authority_status: "verified", management_authority_date: verified, management_authority_expiry: expires,
    management_authority_permissions: "advertise|accept-bookings|contract-guests|provide-access|collect-revenue|manage-cancellations|issue-refunds|manage-incidents",
    licensing_status: "verified", licensing_date: verified, licensing_expiry: expires, insurance_status: "verified", insurance_date: verified, insurance_expiry: expires,
    insurance_public_liability_ngn: "10000000", insurance_annual_aggregate_ngn: "20000000", insurance_property_cover_verified: "true", cancellation_policy: "standard",
    description: "Synthetic demo apartment for automated acceptance.", bathrooms: "1", photo_urls: "",
    extended_stay_opt_in: "true", monthly_accommodation_ngn: "150000", monthly_mandatory_charges_ngn: "5000", power_generator_fuel_included: "true", water_included: "true", internet_included: "true", cleaning_included: "true", cleaning_frequency: "weekly",
  };
  const inventoryHeaders = ["external_listing_id", "unit_id", "property_id", "operator_id", "title", "city", "neighbourhood", "capacity", "bedrooms", "owner_nightly_ngn", "owner_mandatory_charges_ngn", "margin_percent", "refundable_security_deposit_ngn", "currency", "amenities", "inspection_status", "inspection_date", "inspection_expiry", "inspection_scope", "inspection_material_change_pending", "management_authority_status", "management_authority_date", "management_authority_expiry", "management_authority_permissions", "licensing_status", "licensing_date", "licensing_expiry", "insurance_status", "insurance_date", "insurance_expiry", "insurance_public_liability_ngn", "insurance_annual_aggregate_ngn", "insurance_property_cover_verified", "cancellation_policy", "description", "bathrooms", "photo_urls", "extended_stay_opt_in", "monthly_accommodation_ngn", "monthly_mandatory_charges_ngn", "power_generator_fuel_included", "water_included", "internet_included", "cleaning_included", "cleaning_frequency"];
  const csv = `${inventoryHeaders.join(",")}\n${inventoryHeaders.map((header) => values[header] ?? "").join(",")}`;
  const imported = await demoWorkerFetch(tenant, `/_ops/demo/inventory/import?tenantId=${encodeURIComponent(tenant)}`, { method: "POST", headers: { ...opsHeaders(headers), "content-type": "text/csv" }, body: csv });
  expect(imported.status).toBe(200);
  await imported.body?.cancel();

  let expectedAmount = 0;
  let expectedPayer = "";
  let expectedReference = "";
  const paystackFetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "https://api.paystack.co/transaction/initialize" && init?.method === "POST") {
      const body = JSON.parse(String(init?.body)) as { readonly reference: string; readonly amount: number; readonly metadata: string };
      const metadata = JSON.parse(body.metadata) as Record<string, string>;
      expectedReference = body.reference;
      expectedAmount = body.amount;
      expectedPayer = metadata.shortlet_guest_id ?? "";
      return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference, amount: body.amount, metadata } });
    }
    const verification = /^https:\/\/api\.paystack\.co\/transaction\/verify\/([^/]+)$/.exec(url);
    if (verification && init?.method === "GET") {
      const reference = decodeURIComponent(verification[1]!);
      if (reference !== expectedReference) throw new Error("unexpected Paystack reference");
      return Response.json({ status: true, data: { reference, amount: expectedAmount, currency: "NGN", status: "success", domain: "test", metadata: { shortlet_guest_id: expectedPayer } } });
    }
    throw new Error(`Unexpected network request in the demo payment test: ${url}`);
  };
  vi.stubGlobal("fetch", paystackFetchStub);

  try {
    const home = await demoWorkerFetch(tenant, "/");
    expect(home.status).toBe(200);
    const cookie = home.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).toContain("shortlet_guest_session=");
    await home.body?.cancel();
    const threadId = `g-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const post = async (path: string, body: unknown) => demoWorkerFetch(tenant, path, { method: "POST", headers: { cookie: cookie!, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
    const form = async (path: string, fields: Record<string, string>) => demoWorkerFetch(tenant, path, { method: "POST", headers: { cookie: cookie!, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
    const contactPage = await demoWorkerFetch(tenant, "/guest/contact?kind=both", { headers: { cookie: cookie! } });
    expect(contactPage.status).toBe(200);
    const contactHtml = await contactPage.text();
    const currentPhone = /name="phoneNumber"[^>]*value="([^"]*)"/.exec(contactHtml)?.[1] ?? "";
    const currentRevision = /name="expectedRevision" value="(\d+)"/.exec(contactHtml)?.[1] ?? "0";
    if (currentPhone === "") {
      const phone = await form("/guest/contact/phone", { phoneNumber: "+2348012345678", expectedRevision: currentRevision });
      expect(phone.status).toBe(303);
      await phone.body?.cancel();
    }
    let turnResponse = await post("/api/turn", { threadId, text: "I need an apartment in Ikoyi for 30 nights for 2 people" });
    expect(turnResponse.status).toBe(200);
    type HttpComponent = { readonly id: string; readonly action?: { readonly event?: { readonly name?: string; readonly context?: Record<string, unknown> } } };
    type HttpMessage = { readonly updateComponents?: { readonly components?: readonly HttpComponent[] } };
    type HttpSurface = { readonly surfaceId: string; readonly a2uiMessages: readonly HttpMessage[] };
    let turn = await turnResponse.json() as { readonly surfaces: readonly HttpSurface[]; readonly messages: readonly string[] };
    const eventFor = (surface: typeof turn.surfaces[number], eventName: string) => {
      const update = surface.a2uiMessages.find((message) => message.updateComponents);
      const component = update?.updateComponents?.components?.find((candidate) => candidate.action?.event?.name === eventName);
      const seen = update?.updateComponents?.components?.map((candidate) => ({ id: candidate.id, event: candidate.action?.event?.name })) ?? [];
      expect(component, `surface lacks expected event ${eventName}; found ${seen.length} component(s)`).toBeDefined();
      return { name: eventName, context: component?.action?.event?.context ?? {}, surfaceId: surface.surfaceId, sourceComponentId: component!.id, timestamp: new Date().toISOString(), threadId };
    };
    expect(turn.surfaces).toHaveLength(0);
    expect(turn.messages.join(" ")).toMatch(/tell me what date you arrive/i);
    const checkInDate = new Date(`${checkIn}T00:00:00Z`);
    const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(checkInDate);
    const dateReply = await post("/api/turn", { threadId, text: `${checkInDate.getUTCDate()} ${monthLabel}` });
    expect(dateReply.status).toBe(200);
    turn = await dateReply.json() as typeof turn;
    const namedTransitions = [
      "shortlet.discovery.view-unit",
      "shortlet.unit-detail.request-to-book",
      "shortlet.request-draft.review",
      "shortlet.request-draft.submit",
    ];
    for (const eventName of namedTransitions) {
      const surface = turn.surfaces[0];
      expect(surface, `expected a surface for ${eventName}`).toBeDefined();
      const next = await post("/api/event", eventFor(surface!, eventName));
      expect(next.status, `${eventName} returned HTTP ${next.status}`).toBe(200);
      turn = await next.json() as typeof turn;
    }
    const offerSurface = turn.surfaces.find((surface) => surface.surfaceId.includes(":offer:"));
    expect(offerSurface).toBeDefined();
    const acceptEvent = eventFor(offerSurface!, "shortlet.conditional-offer.accept");
    const offerId = typeof acceptEvent.context.offerId === "string" ? acceptEvent.context.offerId : "";
    expect(offerId, "accept event must identify the canonical offer").not.toBe("");
    const accepted = await post("/api/event", acceptEvent);
    expect(accepted.status).toBe(200);
    const acceptedTurn = await accepted.json() as { readonly ok: boolean; readonly surfaces?: readonly HttpSurface[] };
    expect(acceptedTurn.ok).toBe(true);
    const refreshedContact = await demoWorkerFetch(tenant, "/guest/contact?kind=both", { headers: { cookie: cookie! } });
    const refreshedHtml = await refreshedContact.text();
    const currentEmail = /name="contactEmail"[^>]*value="([^"]*)"/.exec(refreshedHtml)?.[1] ?? "";
    const emailRevision = /name="expectedRevision" value="(\d+)"/.exec(refreshedHtml)?.[1] ?? currentRevision;
    if (currentEmail === "") {
      const email = await form("/guest/contact/email", { contactEmail: "guest@example.test", expectedRevision: emailRevision });
      expect(email.status).toBe(303);
      await email.body?.cancel();
    }
    const savedContactPage = await demoWorkerFetch(tenant, "/guest/contact?kind=both", { headers: { cookie: cookie! } });
    expect(savedContactPage.status).toBe(200);
    const savedContactHtml = await savedContactPage.text();
    expect(savedContactHtml).toContain('value="guest@example.test"');

    const continuation = await demoWorkerFetch(tenant, `/payments/offers/${encodeURIComponent(offerId)}/continue`, { headers: { cookie: cookie!, accept: "application/json" } });
      const continuationBody = continuation.status === 303 ? "" : (await continuation.json() as { readonly code?: string }).code ?? "unknown";
      expect(continuation.status, `continuation returned ${continuation.status}; code=${continuationBody}`).toBe(303);
    expect(expectedAmount).toBe(17_825_000);
    const checkoutReference = decodeURIComponent(new URL(continuation.headers.get("location")!).pathname.split("/").at(-1)!);
    await continuation.body?.cancel();

    vi.unstubAllGlobals();
    await abortAllDurableObjects();
    vi.stubGlobal("fetch", paystackFetchStub);
    const restartedDemoNamespace = (env as unknown as { readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"] }).DEMO_SHORTLET;
    const restartedStub = restartedDemoNamespace.get(restartedDemoNamespace.idFromName(tenant));
    const persistedOffer = await runInDurableObject(restartedStub, (_instance, ctx) => {
      const store = new SqliteGuestInteractionStore(new DurableObjectSqlDatabase(ctx.storage));
      const requestId = store.listBookingRequestIds()[0]!;
      const offer = store.findConditionalOfferByRequestId(requestId)!;
      return { offerId: offer.offerId, offerStatus: offer.status };
    });
    expect(persistedOffer.offerId).toBe(offerId);
    expect(persistedOffer.offerStatus).toBe("accepted");
    const callback = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(checkoutReference)}`, { headers: { cookie: cookie! } });
    expect(callback.status).toBe(303);
    await callback.body?.cancel();
    const duplicateCallback = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(checkoutReference)}`, { headers: { cookie: cookie! } });
    expect(duplicateCallback.status).toBe(303);
    await duplicateCallback.body?.cancel();
    const persisted = await runInDurableObject(restartedStub, (_instance, ctx) => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      const contract = new SqliteGuestInteractionStore(database).findBookingSnapshotByOfferId(offerId);
      return contract ? JSON.parse(contract.contractJson) as {
        readonly dates: { readonly nights: number };
        readonly quote: { readonly allInStayTotalKobo: number; readonly billingPeriods: readonly { readonly amountKobo: number }[] };
      } : null;
    });
    expect(persisted?.dates.nights).toBe(30);
    expect(persisted?.quote.allInStayTotalKobo).toBe(17_825_000);
    expect(persisted?.quote.billingPeriods).toHaveLength(1);
    expect(persisted?.quote.billingPeriods[0]?.amountKobo).toBe(persisted?.quote.allInStayTotalKobo);
  } finally {
    vi.unstubAllGlobals();
  }
}, 30_000); // This journey (import, request, payment, confirmation through the Worker) hit vitest's 5000 ms default under full-suite load in the batch gate run; it passes alone. Per-test timeout only.

