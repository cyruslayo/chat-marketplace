import assert from "node:assert/strict";
import type { BookingContract, OwnerSettlementSnapshot } from "../../domains/shortlet/src/index.js";
import { operatorGet, operatorPost, type SignedInOperator } from "./operator-session.js";
import { cookieOf } from "./back-office-reservation.js";
import { visibleText } from "./back-office-page.js";

/** Shared Payouts-page fixtures (B7, issue 11). */

/** The settlement captured at confirmation (P4), read straight from the stored offer. */
export function settlement(f: SignedInOperator, id: string): OwnerSettlementSnapshot {
  const offer = f.server.environment.interactionStore.findConditionalOfferByRequestId(id);
  assert.ok(offer);
  return (JSON.parse(offer.offerJson) as { quote: { ownerSettlement: OwnerSettlementSnapshot } }).quote.ownerSettlement;
}

export function contractOf(f: SignedInOperator, id: string): BookingContract {
  const env = f.server.environment;
  const offer = env.interactionStore.findConditionalOfferByRequestId(id)!;
  return JSON.parse(env.interactionStore.findBookingSnapshotByOfferId(JSON.parse(offer.offerJson).offerId)!.contractJson) as BookingContract;
}

export async function payoutsPage(f: SignedInOperator, cookie = cookieOf(f)): Promise<{ status: number; html: string; text: string }> {
  const response = await operatorGet(f.session, "/operator/payouts", cookie);
  const html = await response.text();
  return { status: response.status, html, text: visibleText(html) };
}

export function payableRow(html: string, id: string): { readonly status: string; readonly text: string; readonly html: string } {
  const match = html.match(new RegExp(`<li class="bo-payable" id="payable-${id}" data-request-id="${id}" data-status="([^"]+)">([\\s\\S]*?)</article></li>`));
  assert.ok(match, `payable ${id} is listed`);
  return { status: match[1]!, text: visibleText(match[2]!), html: match[2]! };
}

export function ownerTotals(html: string, ownerName: string): { readonly due: string; readonly paid: string; readonly notYetDue: string; readonly overpaid: string } {
  const section = [...html.matchAll(/<section class="bo-owner"[\s\S]*?<\/section>/g)].map((m) => m[0]).find((s) => s.includes(`<h2>${ownerName}</h2>`) || s.includes(`>${ownerName}</h2>`));
  assert.ok(section, `owner section for ${ownerName}`);
  const total = (kind: string) => visibleText(section.match(new RegExp(`<dd data-total="${kind}">([\\s\\S]*?)</dd>`))?.[1] ?? "").trim();
  return { due: total("due"), paid: total("paid"), notYetDue: total("not_yet_due"), overpaid: total("overpaid") };
}

export function payoutVersion(html: string, id: string): string {
  const value = payableRow(html, id).html.match(/name="basedOnVersion" value="([^"]+)"/)?.[1];
  assert.ok(value, `payout form for ${id}`);
  return value;
}

export async function pay(f: SignedInOperator, id: string, fields: { amount: string; paidOn: string; reference: string }, options: { cookie?: string; origin?: string; basedOnVersion?: string } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? payoutVersion((await payoutsPage(f)).html, id);
  return operatorPost(f.session, `/operator/payouts/${encodeURIComponent(id)}`, options.cookie ?? cookieOf(f), options.origin ? { origin: options.origin } : {}, { basedOnVersion, ...fields });
}

export const payoutRecords = (f: SignedInOperator) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_owner_payout_recorded").length;
export const naira = (kobo: number) => (kobo / 100).toFixed(2);
