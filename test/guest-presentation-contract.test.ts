import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GUEST_FACT_LABELS, guestFactValue } from "../apps/web-agent/src/guest-content.js";
import { bankTransferArtifactToA2UI } from "../apps/web-agent/src/bank-transfer-a2ui.js";
import type { BankTransferArtifact } from "../apps/web/src/bank-transfer-artifact.js";
import type { GuestSurfacePayload } from "../apps/local-guest/src/guest-server.js";
import { TEST_MANUAL_ACCOUNT } from "./helpers/guest-payment-page.js";
import { factsInOrder, surfaceTexts } from "./helpers/guest-stage-pages.js";
import { restartFixture, type RestartStage } from "./helpers/guest-restart.js";

const CLIENT_SOURCE = new URL("../apps/local-guest/src/client.ts", import.meta.url);
const TICKET = [GUEST_FACT_LABELS.checkIn, GUEST_FACT_LABELS.checkOut, GUEST_FACT_LABELS.stay];

/** One local Guest taken through every booking stage, keeping the surface each stage produced. */
async function surfacesByStage(): Promise<Readonly<Record<string, GuestSurfacePayload>>> {
  const fixture = await restartFixture({ manualTransferAccount: TEST_MANUAL_ACCOUNT }, { localPayment: true });
  try {
    const seen: Record<string, GuestSurfacePayload> = {};
    await fixture.advance("confirmed", (stage: RestartStage, result) => { seen[stage] = result.surfaces[0]!; });
    return seen;
  } finally { await fixture.close(); }
}

let cached: Promise<Readonly<Record<string, GuestSurfacePayload>>> | undefined;
const stages = () => cached ??= surfacesByStage();

test("The label table is frozen and reuses the glossary terms", () => {
  assert.ok(Object.isFrozen(GUEST_FACT_LABELS));
  assert.equal(GUEST_FACT_LABELS.allInStayTotal, "All-In Stay Total");
  assert.equal(GUEST_FACT_LABELS.refundableSecurityDeposit, "Refundable Security Deposit (separate)");
  assert.equal(guestFactValue("Check-in: Thu, 10 Sept 2026", GUEST_FACT_LABELS.checkIn), "Thu, 10 Sept 2026");
  // Failure path: a text that only looks similar, or has no label, is not the fact.
  assert.equal(guestFactValue("Check-in Thu, 10 Sept 2026", GUEST_FACT_LABELS.checkIn), undefined);
  assert.equal(guestFactValue("Refundable Security Deposit collected: ₦20,000", GUEST_FACT_LABELS.refundableSecurityDeposit), undefined);
});

test("AC1 (request draft builder): the ticket and money facts are separate label-prefixed Texts in canonical order", async () => {
  const { draft, review } = await stages();
  const draftFacts = factsInOrder(surfaceTexts(draft!), [...TICKET, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit]);
  assert.equal(draftFacts[2], "Stay: 3 nights · 2 guests");
  assert.ok(!surfaceTexts(draft!).some((text) => text.startsWith(GUEST_FACT_LABELS.amountDueNow)), "a draft has no amount line yet");
  // The review adds the condition and the amount line after the deposit.
  factsInOrder(surfaceTexts(review!), [...TICKET, GUEST_FACT_LABELS.ifRequestAccepted, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit, GUEST_FACT_LABELS.amountDueNow]);
  assert.throws(() => factsInOrder(surfaceTexts(review!), [GUEST_FACT_LABELS.amountDueNow, GUEST_FACT_LABELS.allInStayTotal]), /No Text starts with/, "the order is enforced");
});

test("AC1 (booking request builder): the ticket and money facts are separate label-prefixed Texts in canonical order", async () => {
  const { pending } = await stages();
  factsInOrder(surfaceTexts(pending!), [...TICKET, GUEST_FACT_LABELS.ifRequestAccepted, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit, GUEST_FACT_LABELS.amountDueNow]);
});

test("AC1 (conditional offer builder): the ticket and money facts are separate label-prefixed Texts in canonical order", async () => {
  const { offer } = await stages();
  factsInOrder(surfaceTexts(offer!), [...TICKET, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit, GUEST_FACT_LABELS.amountDueNow]);
  assert.ok(!surfaceTexts(offer!).includes(GUEST_FACT_LABELS.ifRequestAccepted), "an issued offer is no longer conditional on acceptance");
});

test("AC1 (card payment builder): the ticket and money facts are separate label-prefixed Texts in canonical order", async () => {
  const stage = await stages();
  const ready = factsInOrder(surfaceTexts(stage["payment-ready"]!), [...TICKET, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit, GUEST_FACT_LABELS.amountDueNow, GUEST_FACT_LABELS.nextPayment]);
  assert.equal(ready[2], "Stay: 3 nights · 2 guests", "the party comes from the offer");
});

test("AC1 (booking contract builder): the ticket and money facts are separate label-prefixed Texts in canonical order", async () => {
  const { confirmed } = await stages();
  factsInOrder(surfaceTexts(confirmed!), [...TICKET, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit, GUEST_FACT_LABELS.amountPaid]);
});

test("AC1 (bank transfer builder): the ticket and money facts are separate label-prefixed Texts in canonical order", () => {
  // The chat does not present the transfer screen yet, so the builder is exercised directly with an authoritative artifact.
  const artifact: BankTransferArtifact = {
    id: "bank-transfer:offer", kind: "shortlet.bank-transfer", schemaVersion: "shortlet.bank-transfer/v1", projectionVersion: 2,
    facts: { offerId: "offer", status: "transfer_initiated", unit: "Lekki Loft", unitId: "unit", checkIn: "2026-10-03", checkOut: "2026-10-05", occupantCount: 2, allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 20_000_00, amountDueNowKobo: 390_000_00, currency: "NGN", paymentWindowExpiresAt: "2026-10-01T12:20:00Z", graceEndsAt: "2026-10-01T12:30:00Z", bankName: "Bank", accountNumber: "012345", transferReference: "ref" },
    actions: [], sensitivity: "booking-sensitive",
  };
  const texts = surfaceTexts({ a2uiMessages: bankTransferArtifactToA2UI({ artifact, surfaceId: "surface" }) });
  const facts = factsInOrder(texts, [...TICKET, GUEST_FACT_LABELS.allInStayTotal, GUEST_FACT_LABELS.refundableSecurityDeposit, GUEST_FACT_LABELS.amountDueNow]);
  assert.equal(facts[0], "Check-in: Sat, 3 Oct 2026");
  assert.equal(facts[2], "Stay: 2 nights · 2 guests");
  // Failure path: without a stored party size the foot line claims no guest count.
  const { occupantCount: _omitted, ...withoutParty } = artifact.facts;
  const noParty = surfaceTexts({ a2uiMessages: bankTransferArtifactToA2UI({ artifact: { ...artifact, facts: withoutParty }, surfaceId: "surface" }) });
  assert.ok(noParty.includes("Stay: 2 nights"));
});

test("AC2: client.ts finds booking facts through the shared label table, with no regex over their wording", async () => {
  const source = await readFile(CLIENT_SOURCE, "utf8");
  assert.match(source, /GUEST_FACT_LABELS/);
  assert.match(source, /guestFactValue/);
  // Every line of the client that runs a regex (.test, .match, .replace with a pattern, new RegExp).
  const regexLines = source.split("\n").filter((line) => /\.test\(|\.match\(|\.search\(|\.replace\(\/|new RegExp/.test(line));
  assert.ok(regexLines.length >= 5, "the scan sees the client's regex lines");
  const wording = /Stay|Guests?|guest|occupant|Total to complete|Amount|Refundable|Check-?in|Check-?out|Mon\||Tue\||Deposit|Paid/;
  assert.deepEqual(regexLines.filter((line) => wording.test(line)), [], "no regex mentions the presented wording of a booking fact");
  for (const legacy of ["Total to complete booking", "Amount Due Now", "Amount due now", "Amount paid", "Stay payment paid", "Stay payment verified"]) assert.ok(!source.includes(legacy), `client.ts does not spell "${legacy}" itself`);
});

test("AC5: every surface's textFallback still contains the All-In Stay Total, the deposit, the amount line and the deadline", async () => {
  const stage = await stages();
  const fallbacks: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["review", ["All-In Stay Total: ₦370,000", "Refundable Security Deposit (separate): ₦20,000", "Total to complete booking: ₦390,000"]],
    ["pending", ["All-In Stay Total: ₦370,000", "Refundable Security Deposit (separate): ₦20,000", "Total to complete booking: ₦390,000", "Operator response deadline: "]],
    ["offer", ["All-In Stay Total: ₦370,000", "Refundable Security Deposit (separate): ₦20,000", "Total to complete booking: ₦390,000", "Pay by "]],
    ["payment-ready", ["All-In Stay Total: ₦370,000", "Refundable Security Deposit (separate): ₦20,000", "Total to complete booking: ₦390,000", "11:20 am WAT, 3 Sept 2026"]],
    ["confirmed", ["Stay payment paid: ₦370,000", "Refundable Security Deposit collected: ₦20,000"]],
  ];
  for (const [name, required] of fallbacks) {
    const fallback = stage[name]!.textFallback ?? "";
    for (const text of required) assert.ok(fallback.includes(text), `${name} fallback contains "${text}": ${fallback}`);
  }
  // Failure path: a surface's fallback never carries a label the A2UI no longer uses.
  for (const surface of Object.values(stage)) assert.doesNotMatch(surface.textFallback ?? "", /Amount due now|Amount paid|Stay payment verified/);
});
