import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { GUEST_FACT_LABELS, guestFactValue } from "../apps/web-agent/src/guest-content.js";
import { bankTransferArtifactToA2UI } from "../apps/web-agent/src/bank-transfer-a2ui.js";
import type { BankTransferArtifact } from "../apps/web/src/bank-transfer-artifact.js";
import type { GuestSurfacePayload } from "../apps/local-guest/src/guest-server.js";
import { breakdownHtml } from "../apps/local-guest/src/guest-kit.js";
import { TEST_MANUAL_ACCOUNT } from "./helpers/guest-payment-page.js";
import { restartFixture, type RestartStage } from "./helpers/guest-restart.js";
import { priceBreakdown, rootChildTypes, stayTicket, type PriceBreakdownProps } from "./helpers/booking-components.js";

const CLIENT_SOURCE = new URL("../apps/local-guest/src/client.ts", import.meta.url);

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

const messagesOf = (surface: GuestSurfacePayload): readonly A2UIServerMessage[] => surface.a2uiMessages as unknown as readonly A2UIServerMessage[];

/** The label each money prop shows on the breakdown (guest-kit `breakdownHtml`). A collected deposit reads "... collected". */
type MoneyKey = "condition" | "total" | "deposit" | "due" | "paid" | "next";
const MONEY_LABEL: Readonly<Record<MoneyKey, string>> = {
  condition: GUEST_FACT_LABELS.ifRequestAccepted,
  total: GUEST_FACT_LABELS.allInStayTotal,
  deposit: "Refundable Security Deposit",
  due: GUEST_FACT_LABELS.amountDueNow,
  paid: GUEST_FACT_LABELS.amountPaid,
  next: GUEST_FACT_LABELS.nextPayment,
};

/** Weaver catalogues issue 04: each named money prop is present, and its line appears in the breakdown's display order. */
function moneyInOrder(money: PriceBreakdownProps, keys: readonly MoneyKey[]): void {
  for (const key of keys) assert.notEqual(money[key], undefined, `${key} is a PriceBreakdown prop`);
  const html = breakdownHtml(money);
  let from = 0;
  for (const key of keys) {
    const at = html.indexOf(MONEY_LABEL[key], from);
    if (at < 0) throw new Error(`No ${MONEY_LABEL[key]} after position ${from} in the breakdown`);
    from = at + 1;
  }
}

/** Weaver catalogues issue 04: the ticket is a typed StayTicket placed above the typed PriceBreakdown (ADR 0015). */
function ticketAboveMoney(messages: readonly A2UIServerMessage[]): void {
  const order = rootChildTypes(messages);
  assert.ok(order.includes("StayTicket") && order.indexOf("StayTicket") < order.indexOf("PriceBreakdown"), `ticket above money: ${order.join(",")}`);
}

test("The label table is frozen and reuses the glossary terms", () => {
  assert.ok(Object.isFrozen(GUEST_FACT_LABELS));
  assert.equal(GUEST_FACT_LABELS.allInStayTotal, "All-In Stay Total");
  assert.equal(GUEST_FACT_LABELS.refundableSecurityDeposit, "Refundable Security Deposit (separate)");
  assert.equal(guestFactValue("Check-in: Thu, 10 Sept 2026", GUEST_FACT_LABELS.checkIn), "Thu, 10 Sept 2026");
  // Failure path: a text that only looks similar, or has no label, is not the fact.
  assert.equal(guestFactValue("Check-in Thu, 10 Sept 2026", GUEST_FACT_LABELS.checkIn), undefined);
  assert.equal(guestFactValue("Refundable Security Deposit collected: ₦20,000", GUEST_FACT_LABELS.refundableSecurityDeposit), undefined);
});

test("AC1 (request draft builder): the ticket and money facts are a typed StayTicket and PriceBreakdown in canonical order", async () => {
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  const { draft, review } = await stages();
  const draftMessages = messagesOf(draft!);
  ticketAboveMoney(draftMessages);
  assert.equal(stayTicket(draftMessages).foot, "3 nights · 2 guests");
  const draftMoney = priceBreakdown(draftMessages);
  moneyInOrder(draftMoney, ["total", "deposit"]);
  assert.equal(draftMoney.due, undefined, "a draft has no amount line yet");
  // The review adds the condition and the amount line after the deposit.
  const reviewMessages = messagesOf(review!);
  ticketAboveMoney(reviewMessages);
  moneyInOrder(priceBreakdown(reviewMessages), ["condition", "total", "deposit", "due"]);
  assert.throws(() => moneyInOrder(priceBreakdown(reviewMessages), ["due", "total"]), /No All-In Stay Total/, "the order is enforced");
});

test("AC1 (booking request builder): the ticket and money facts are a typed StayTicket and PriceBreakdown in canonical order", async () => {
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  const { pending } = await stages();
  ticketAboveMoney(messagesOf(pending!));
  moneyInOrder(priceBreakdown(messagesOf(pending!)), ["condition", "total", "deposit", "due"]);
});

test("AC1 (conditional offer builder): the ticket and money facts are a typed StayTicket and PriceBreakdown in canonical order", async () => {
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  const { offer } = await stages();
  ticketAboveMoney(messagesOf(offer!));
  const money = priceBreakdown(messagesOf(offer!));
  moneyInOrder(money, ["total", "deposit", "due"]);
  assert.equal(money.condition, undefined, "an issued offer is no longer conditional on acceptance");
});

test("AC1 (card payment builder): the ticket and money facts are a typed StayTicket and PriceBreakdown in canonical order", async () => {
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  const stage = await stages();
  const ready = messagesOf(stage["payment-ready"]!);
  ticketAboveMoney(ready);
  moneyInOrder(priceBreakdown(ready), ["total", "deposit", "due", "next"]);
  assert.equal(stayTicket(ready).foot, "3 nights · 2 guests", "the party comes from the offer");
});

test("AC1 (booking contract builder): the ticket and money facts are a typed StayTicket and PriceBreakdown in canonical order", async () => {
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  const { confirmed } = await stages();
  const messages = messagesOf(confirmed!);
  ticketAboveMoney(messages);
  const money = priceBreakdown(messages);
  moneyInOrder(money, ["total", "deposit", "paid"]);
  assert.equal(money.depositCollected, true, "the confirmed deposit is marked collected");
});

test("AC1 (bank transfer builder): the ticket and money facts are a typed StayTicket and PriceBreakdown in canonical order", () => {
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  // The chat does not present the transfer screen yet, so the builder is exercised directly with an authoritative artifact.
  const artifact: BankTransferArtifact = {
    id: "bank-transfer:offer", kind: "shortlet.bank-transfer", schemaVersion: "shortlet.bank-transfer/v1", projectionVersion: 2,
    facts: { offerId: "offer", status: "transfer_initiated", unit: "Lekki Loft", unitId: "unit", checkIn: "2026-10-03", checkOut: "2026-10-05", occupantCount: 2, allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 20_000_00, amountDueNowKobo: 390_000_00, currency: "NGN", paymentWindowExpiresAt: "2026-10-01T12:20:00Z", graceEndsAt: "2026-10-01T12:30:00Z", bankName: "Bank", accountNumber: "012345", transferReference: "ref" },
    actions: [], sensitivity: "booking-sensitive",
  };
  const messages = bankTransferArtifactToA2UI({ artifact, surfaceId: "surface" });
  ticketAboveMoney(messages);
  assert.equal(stayTicket(messages).checkIn.date, "Sat, 3 Oct 2026");
  assert.equal(stayTicket(messages).foot, "2 nights · 2 guests");
  moneyInOrder(priceBreakdown(messages), ["total", "deposit", "due"]);
  // Failure path: without a stored party size the foot line claims no guest count.
  const { occupantCount: _omitted, ...withoutParty } = artifact.facts;
  const noParty = bankTransferArtifactToA2UI({ artifact: { ...artifact, facts: withoutParty }, surfaceId: "surface" });
  assert.equal(stayTicket(noParty).foot, "2 nights");
});

test("AC2: client.ts finds no booking facts by label, with no regex over their wording", async () => {
  const source = await readFile(CLIENT_SOURCE, "utf8");
  // Weaver catalogues issue 04 (AC6): the client no longer looks booking facts up by label; the typed props carry them.
  assert.doesNotMatch(source, /guestFactValue|organizeBookingTicket/);
  // Every line of the client that runs a regex (.test, .match, .replace with a pattern, new RegExp).
  const regexLines = source.split("\n").filter((line) => /\.test\(|\.match\(|\.search\(|\.replace\(\/|new RegExp/.test(line));
  assert.ok(regexLines.length >= 5, "the scan sees the client's regex lines");
  const wording = /Stay|Guests?|guest|occupant|Total to complete|Amount|Refundable|Check-?in|Check-?out|Mon\||Tue\||Deposit|Paid/;
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
