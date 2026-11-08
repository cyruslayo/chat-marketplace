import { escapeHtml, formatMoney } from "../../web/src/ui-kit.js";
import type { PilotMetricsReport, PilotPaymentMetric } from "../../../domains/shortlet/src/index.js";
import { backOfficePage, watTime, type BackOfficeViewer } from "./back-office-view.js";

/**
 * The pilot metrics page (production-launch issue 09, pilot-launch-readiness/13). It renders only counts, rates,
 * durations and money derived from the authoritative store. It never renders a guest contact, card detail or payment
 * reference (ADR 0075, 0096), and an unavailable metric says so instead of showing zero.
 */

const METRICS_STYLE = [
  ".bo-metrics{width:100%;border-collapse:collapse;margin:0}",
  ".bo-metrics caption{text-align:start;font-weight:600;padding-block-end:var(--space-2)}",
  ".bo-metrics th,.bo-metrics td{padding:var(--space-2);border-block-end:1px solid var(--color-border-subtle);text-align:start;vertical-align:top}",
  ".bo-metrics thead th{font-size:var(--font-size-small)}",
  ".bo-metrics td.bo-metrics__number,.bo-metrics th.bo-metrics__number{text-align:end;font-variant-numeric:tabular-nums}",
  ".bo-metrics__note{margin:0;color:var(--color-text-muted)}",
].join("");

const PAYMENT_METHOD_LABELS: Readonly<Record<PilotPaymentMetric["method"], string>> = Object.freeze({
  fresh_card: "Card",
  manual_transfer: "Manual bank transfer",
  bank_transfer: "Paystack bank transfer",
});

function share(value: number | null): string {
  return value === null ? "No data yet" : `${Math.round(value * 100)}%`;
}

function duration(milliseconds: number | null): string {
  if (milliseconds === null) return "No data yet";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : `${hours}h ${rest}m`;
}

function paymentCells(payment: Extract<PilotPaymentMetric, { available: true }>): string {
  const refunds = payment.refundsPending === 0
    ? String(payment.refunded)
    : `${payment.refunded} <span class="bo-metrics__note">(+${payment.refundsPending} pending)</span>`;
  return [
    `<td class="bo-metrics__number">${payment.started}</td>`,
    `<td class="bo-metrics__number">${payment.completed}</td>`,
    `<td class="bo-metrics__number">${payment.expired}</td>`,
    `<td class="bo-metrics__number">${payment.failed}</td>`,
    `<td class="bo-metrics__number">${refunds}</td>`,
    `<td class="bo-metrics__number">${formatMoney(payment.refundedKobo)}${payment.refundsPendingKobo > 0 ? ` <span class="bo-metrics__note">(${formatMoney(payment.refundsPendingKobo)} pending)</span>` : ""}</td>`,
  ].join("");
}

export function pilotMetricsPage(viewer: BackOfficeViewer, report: PilotMetricsReport): string {
  const requests = report.requests;
  const checkIns = report.checkIns;
  const money = report.money;
  const refunds = report.refunds;
  const relocations = report.relocations.available
    ? `<dt>Relocations</dt><dd>${report.relocations.count} (${formatMoney(report.relocations.amountKobo)})</dd>`
    : `<dt>Relocations</dt><dd>Not available. ${escapeHtml(report.relocations.reason)}</dd>`;

  const body = [
    `<header class="ui-page__header"><p class="ui-eyebrow">Pilot metrics</p><h1>Pilot metrics</h1><p>The owners you act for. Generated ${watTime(report.generatedAt)}.</p></header>`,
    `<section class="ui-panel" aria-labelledby="metrics-requests"><h2 id="metrics-requests">Requests</h2><dl class="ui-facts">`,
    `<dt>Requests received</dt><dd>${requests.received}</dd>`,
    `<dt>Confirmed</dt><dd>${requests.confirmed} (${share(requests.confirmedShare)})</dd>`,
    `<dt>Declined</dt><dd>${requests.declined}</dd>`,
    `<dt>Median time to confirm</dt><dd>${duration(requests.medianTimeToConfirmMs)}</dd>`,
    `</dl></section>`,
    `<section class="ui-panel" aria-labelledby="metrics-payments"><h2 id="metrics-payments">Payments by method</h2>`,
    `<table class="bo-metrics"><caption>Payment attempts and their outcomes</caption><thead><tr><th scope="col">Method</th><th scope="col" class="bo-metrics__number">Started</th><th scope="col" class="bo-metrics__number">Completed</th><th scope="col" class="bo-metrics__number">Expired</th><th scope="col" class="bo-metrics__number">Failed</th><th scope="col" class="bo-metrics__number">Refunded</th><th scope="col" class="bo-metrics__number">Refunded amount</th></tr></thead><tbody>`,
    ...report.payments.flatMap((payment) => [
      `<tr data-method="${payment.method}"><th scope="row">${escapeHtml(PAYMENT_METHOD_LABELS[payment.method])}</th>${payment.available ? paymentCells(payment) : `<td colspan="6" class="bo-metrics__note">Not available. ${escapeHtml(payment.reason)}</td>`}</tr>`,
    ]),
    `</tbody></table></section>`,
    `<section class="ui-panel" aria-labelledby="metrics-checkins"><h2 id="metrics-checkins">Check-ins, incidents and relocations</h2><dl class="ui-facts">`,
    `<dt>Check-ins with Verified Access</dt><dd>${checkIns.verifiedAccess} of ${checkIns.reservations} (${share(checkIns.verifiedAccessShare)})</dd>`,
    `<dt>Incidents</dt><dd>${checkIns.incidents}</dd>`,
    `<dt>Incidents per stay</dt><dd>${checkIns.incidentsPerStay === null ? "No data yet" : checkIns.incidentsPerStay.toFixed(2)}</dd>`,
    relocations,
    `</dl></section>`,
    `<section class="ui-panel" aria-labelledby="metrics-refunds"><h2 id="metrics-refunds">Refunds</h2><dl class="ui-facts">`,
    `<dt>Paid to Guests</dt><dd>${refunds.paidToGuests.count} (${formatMoney(refunds.paidToGuests.amountKobo)})</dd>`,
    `<dt>Decided under a cancellation policy</dt><dd>${refunds.decidedByPolicy.count} (${formatMoney(refunds.decidedByPolicy.amountKobo)})</dd>`,
    `<dt>Recorded for refund</dt><dd>${refunds.recordedForRefund.count} (${formatMoney(refunds.recordedForRefund.amountKobo)})</dd>`,
    `</dl></section>`,
    `<section class="ui-panel" aria-labelledby="metrics-money"><h2 id="metrics-money">Money</h2><dl class="ui-facts">`,
    `<dt>Margin earned</dt><dd class="ui-money-total">${formatMoney(money.marginEarnedKobo)}</dd>`,
    `<dt>Owner payables due</dt><dd>${formatMoney(money.ownerPayablesDueKobo)}</dd>`,
    `<dt>Owner payables paid</dt><dd>${formatMoney(money.ownerPayablesPaidKobo)}</dd>`,
    `<dt>Owner payables not yet due</dt><dd>${formatMoney(money.ownerPayablesNotYetDueKobo)}</dd>`,
    `</dl></section>`,
  ].join("");

  return backOfficePage({ title: "Pilot metrics", viewer, current: "metrics", body, style: METRICS_STYLE });
}
