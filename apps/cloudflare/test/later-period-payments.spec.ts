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

// Demo-launch issue 12 AC4 (ADR 0092): a 180-night demo stay pays period 1, then period 2 in its own Paystack TEST session,
// through the Worker and its Durable Object. Paystack TEST is stubbed on the global fetch. The clock is fixed at START
// (11:00 WAT) and advanced to check-in only after period 1 is confirmed, which makes period 2 payable (ADR 0092).
// The journey setup repeats demo-extended-stay.spec.ts (the 30-night AC6 journey); extracting it is a follow-up.

test("AC4: the demo Worker pays period 1, then period 2 in its own session, refuses a wrong amount and a future period, and keeps the payments after a Durable Object restart", async () => {
  const tenant = `demo-later-${crypto.randomUUID()}`;
  const stub = (env as unknown as { readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"] }).DEMO_SHORTLET.get((env as unknown as { readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"] }).DEMO_SHORTLET.idFromName(tenant));
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const date = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const checkIn = date(7);
  const checkOut = date(187);
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

  // Stubbed Paystack TEST: every initialized reference keeps its own amount; verification echoes it (or one unit more when asked).
  const amountByReference = new Map<string, number>();
  const starts: string[] = [];
  let expectedPayer = "";
  let wrongAmount = false;
  const paystackFetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "https://api.paystack.co/transaction/initialize" && init?.method === "POST") {
      const body = JSON.parse(String(init?.body)) as { readonly reference: string; readonly amount: number; readonly metadata: string };
      const metadata = JSON.parse(body.metadata) as Record<string, string>;
      amountByReference.set(body.reference, body.amount);
      starts.push(body.reference);
      expectedPayer = metadata.shortlet_guest_id ?? "";
      return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference, amount: body.amount, metadata } });
    }
    const verification = /^https:\/\/api\.paystack\.co\/transaction\/verify\/([^/]+)$/.exec(url);
    if (verification && init?.method === "GET") {
      const reference = decodeURIComponent(verification[1]!);
      const amount = amountByReference.get(reference);
      if (amount === undefined) throw new Error("unexpected Paystack reference");
      return Response.json({ status: true, data: { reference, amount: wrongAmount ? amount + 1 : amount, currency: "NGN", status: "success", domain: "test", metadata: { shortlet_guest_id: expectedPayer } } });
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
    const post = async (path: string, body: unknown) => demoWorkerFetch(tenant, path, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
    const form = async (path: string, fields: Record<string, string>) => demoWorkerFetch(tenant, path, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
    const contactPage = await demoWorkerFetch(tenant, "/guest/contact?kind=both", { headers: { cookie } });
    expect(contactPage.status).toBe(200);
    const contactHtml = await contactPage.text();
    const currentPhone = /name="phoneNumber"[^>]*value="([^"]*)"/.exec(contactHtml)?.[1] ?? "";
    const currentRevision = /name="expectedRevision" value="(\d+)"/.exec(contactHtml)?.[1] ?? "0";
    if (currentPhone === "") {
      const phone = await form("/guest/contact/phone", { phoneNumber: "+2348012345678", expectedRevision: currentRevision });
      expect(phone.status).toBe(303);
      await phone.body?.cancel();
    }
    const turnResponse = await post("/api/turn", { threadId, text: "I need an apartment in Ikoyi for 2 people" });
    expect(turnResponse.status).toBe(200);
    type HttpComponent = { readonly id: string; readonly action?: { readonly event?: { readonly name?: string; readonly context?: Record<string, unknown> } } };
    type HttpMessage = { readonly updateComponents?: { readonly components?: readonly HttpComponent[] } };
    type HttpSurface = { readonly surfaceId: string; readonly a2uiMessages: readonly HttpMessage[] };
    let turn = await turnResponse.json() as { readonly surfaces: readonly HttpSurface[]; readonly messages: readonly string[] };
    const eventFor = (surface: typeof turn.surfaces[number], eventName: string) => {
      const update = surface.a2uiMessages.find((message) => message.updateComponents);
      const component = update?.updateComponents?.components?.find((candidate) => candidate.action?.event?.name === eventName);
      expect(component, `surface lacks expected event ${eventName}`).toBeDefined();
      return { name: eventName, context: component?.action?.event?.context ?? {}, surfaceId: surface.surfaceId, sourceComponentId: component!.id, timestamp: new Date().toISOString(), threadId };
    };
    expect(turn.messages.join(" ")).toMatch(/tell me what date you arrive/i);
    const dayMonthYear = (value: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
    const dateReply = await post("/api/turn", { threadId, text: `${dayMonthYear(new Date(`${checkIn}T00:00:00Z`))} to ${dayMonthYear(new Date(`${checkOut}T00:00:00Z`))}` });
    expect(dateReply.status).toBe(200);
    turn = await dateReply.json() as typeof turn;
    for (const eventName of ["shortlet.discovery.view-unit", "shortlet.unit-detail.request-to-book", "shortlet.request-draft.review", "shortlet.request-draft.submit"]) {
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
    expect(offerId).not.toBe("");
    const accepted = await post("/api/event", acceptEvent);
    expect(accepted.status).toBe(200);
    const refreshedContact = await demoWorkerFetch(tenant, "/guest/contact?kind=both", { headers: { cookie } });
    const refreshedHtml = await refreshedContact.text();
    const currentEmail = /name="contactEmail"[^>]*value="([^"]*)"/.exec(refreshedHtml)?.[1] ?? "";
    const emailRevision = /name="expectedRevision" value="(\d+)"/.exec(refreshedHtml)?.[1] ?? currentRevision;
    if (currentEmail === "") {
      const email = await form("/guest/contact/email", { contactEmail: "guest@example.test", expectedRevision: emailRevision });
      expect(email.status).toBe(303);
      await email.body?.cancel();
    }
    const continuation = await demoWorkerFetch(tenant, `/payments/offers/${encodeURIComponent(offerId)}/continue`, { headers: { cookie, accept: "application/json" } });
    expect(continuation.status, "period 1 checkout continues").toBe(303);
    const period1Reference = decodeURIComponent(new URL(continuation.headers.get("location")!).pathname.split("/").at(-1)!);
    await continuation.body?.cancel();
    expect(amountByReference.get(period1Reference)).toBe(17_825_000);
    const period1Callback = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(period1Reference)}`, { headers: { cookie } });
    expect(period1Callback.status).toBe(303);
    await period1Callback.body?.cancel();

    // Period 1 has started: period 2 is payable and period 3 is not (ADR 0092).
    vi.setSystemTime(new Date(`${checkIn}T10:00:00.000Z`));
    const schedulePath = `/bookings/periods/${encodeURIComponent(offerId)}`;
    const readSchedule = async () => (await demoWorkerFetch(tenant, schedulePath, { headers: { cookie } })).text();
    const before = await readSchedule();
    expect(before).toContain(`data-period="1" data-status="paid"`);
    expect(before).toContain(`data-period="2" data-status="payable"`);
    expect(before).toContain(`data-period="3" data-status="scheduled"`);
    expect(before).not.toContain(`data-period="3" data-status="paid"`);

    const future = await demoWorkerFetch(tenant, `/payments/periods/${encodeURIComponent(offerId)}/3`, { method: "POST", headers: { cookie, origin: ORIGIN } });
    expect(future.status, "a future period cannot start").toBe(400);
    await future.body?.cancel();
    expect(starts).toHaveLength(1);

    // Period 2 starts in its own Paystack TEST session.
    const start2 = await demoWorkerFetch(tenant, `/payments/periods/${encodeURIComponent(offerId)}/2`, { method: "POST", headers: { cookie, origin: ORIGIN } });
    if (start2.status !== 303) throw new Error("START2 " + start2.status + " " + (await start2.text()).slice(0, 300));
    expect(start2.headers.get("location") ?? "").toMatch(/^https:\/\/checkout\.paystack\.com\//);
    await start2.body?.cancel();
    const period2Reference = starts.at(-1)!;
    expect(period2Reference).not.toBe(period1Reference);

    // A wrong amount is refused and leaves period 2 unpaid; the same reference confirms once the amount is right.
    wrongAmount = true;
    const wrong = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(period2Reference)}`, { headers: { cookie } });
    expect(wrong.status).toBe(400);
    await wrong.body?.cancel();
    expect(await readSchedule()).not.toContain(`data-period="2" data-status="paid"`);
    wrongAmount = false;

    const callback2 = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(period2Reference)}`, { headers: { cookie } });
    expect(callback2.status).toBe(303);
    await callback2.body?.cancel();
    const duplicate = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(period2Reference)}`, { headers: { cookie } });
    expect(duplicate.status).toBe(303);
    await duplicate.body?.cancel();
    const afterPeriod2 = await readSchedule();
    expect(afterPeriod2).toContain(`data-period="2" data-status="paid"`);
    expect(afterPeriod2).not.toContain(`data-period="3" data-status="paid"`);
    expect(afterPeriod2.match(/data-status="paid"/g)).toHaveLength(2);

    // Restart: abort every Durable Object and reinstall fresh stubs; the payments stay as they were.
    vi.unstubAllGlobals();
    await abortAllDurableObjects();
    vi.stubGlobal("fetch", paystackFetchStub);
    // Cold start: the first read goes to the Durable Object store, as demo-extended-stay.spec.ts does before its HTTP
    // callback after a restart. Without it the first HTTP request after abort fails on the guest session store
    // ("no such table: guest_threads"), a cold-start defect recorded in the issue Comments.
    const restartedNamespace = (env as unknown as { readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"] }).DEMO_SHORTLET;
    const restartedStub = restartedNamespace.get(restartedNamespace.idFromName(tenant));
    const persistedPeriods = await runInDurableObject(restartedStub, (_instance, ctx) => {
      const store = new SqliteGuestInteractionStore(new DurableObjectSqlDatabase(ctx.storage));
      return store.listPeriodPayments(offerId).map((payment) => payment.periodIndex);
    });
    expect(persistedPeriods, "period 2 survives the restart, period 3 does not exist as paid").toEqual([2]);
    const afterRestart = await readSchedule();
    expect(afterRestart).toContain(`data-period="2" data-status="paid"`);
    expect(afterRestart.match(/data-status="paid"/g)).toHaveLength(2);
    const restartedDuplicate = await demoWorkerFetch(tenant, `/payments/paystack/callback?reference=${encodeURIComponent(period2Reference)}`, { headers: { cookie } });
    expect(restartedDuplicate.status).toBe(303);
    await restartedDuplicate.body?.cancel();
    expect((await readSchedule()).match(/data-status="paid"/g)).toHaveLength(2);
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);
