import { type A2UIComponent, type A2UIServerMessage } from "@cylayo/weaver-core";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, CARD_PAYMENT_VERIFY_RETURN_EVENT } from "../../web/src/card-payment-actions.js";
import type { CardPaymentArtifact } from "../../web/src/card-payment-artifact.js";

import { bookingProgressText, bookingTicketComponents, formatBookingDeadline, formatBookingMoney, guestPaymentStatus, nightsBetween, priceBreakdownComponent } from "./booking-presentation.js";
import { billingPeriodLines, cardPaymentBillingPeriod } from "./extended-stay-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, guestFact } from "./guest-content.js";
import { cardPaymentCopy, isCardPaymentProcessing } from "./payment-presentation.js";
import { surfaceMessages } from "./a2ui-surface.js";
import { SHORTLET_BOOKING_CATALOG_ID } from "./shortlet-catalogs.js";

export function cardPaymentArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: CardPaymentArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const isProcessing = isCardPaymentProcessing(facts);
  const copy = cardPaymentCopy(facts);
  const paymentStatus = guestPaymentStatus(facts.status, isProcessing);
  // ADR-0015/0016/0077: show the quoted full requirement separately from the
  // exact component amount on the current server-authorized checkout stage.
  const component = facts.currentComponent ?? (facts.status === "deposit_required" ? "security_deposit" : facts.status === "ready" ? "stay" : undefined);
  const componentAmount = facts.currentComponentAmountKobo ?? (facts.status === "ready"
    ? facts.allInStayTotalKobo
    : facts.status === "deposit_required"
      ? facts.refundableSecurityDepositKobo
      : undefined);
  const componentLabel = component === "security_deposit" ? GUEST_GLOSSARY.refundableSecurityDeposit : "stay payment";
  const componentText = component && componentAmount !== undefined
    ? `${isProcessing ? (component === "security_deposit" ? GUEST_GLOSSARY.refundableSecurityDeposit : "Stay payment") + " being checked" : `${GUEST_FACT_LABELS.nextPayment}: ${componentLabel}`} · ${formatBookingMoney(componentAmount)}`
    : undefined;
  const showTotalRequirement = facts.status === "ready" || facts.status === "deposit_required";
  const stage = paymentStatus.progress;
  const action = artifact.actions[0];
  const actionAmount = componentAmount ?? facts.amountDueNowKobo;
  const actionLabel = action?.type === "verify_return"
    ? "Check payment status"
    : facts.status === "deposit_required"
      ? `Continue to ${GUEST_GLOSSARY.refundableSecurityDeposit} · ${formatBookingMoney(actionAmount)}`
      : `Continue to stay payment · ${formatBookingMoney(actionAmount)}`;
  // Issue 27 (ADR 0092): the Extended Stay schedule and which period this payment covers, from the projection.
  const schedulePeriods = billingPeriodLines(facts.billingPeriods);
  const scheduleIds = schedulePeriods.map((_, index) => `card-payment-period-${index}`);
  const currentPeriod = cardPaymentBillingPeriod(facts);
  const currentPeriodText = currentPeriod === undefined ? undefined : `This payment is for ${GUEST_FACT_LABELS.billingPeriod} ${currentPeriod.index}.`;
  // Weaver catalogues issue 04 (ADR 0102): typed StayTicket / PriceBreakdown in place of label-prefixed Texts.
  const ticket = bookingTicketComponents("card-payment", facts.unit, { checkIn: facts.checkIn, checkOut: facts.checkOut, nights: nightsBetween(facts.checkIn, facts.checkOut), ...(facts.occupantCount === undefined ? {} : { guestCount: facts.occupantCount }) });
  // With a total, the money lines are one PriceBreakdown; without one they stay Texts, as before. The "Next payment" line
  // (not while processing) is the breakdown's `next` part.
  const totalKobo = facts.allInStayTotalKobo;
  const depositKobo = facts.refundableSecurityDepositKobo;
  const componentNext = componentText === undefined || isProcessing || componentAmount === undefined ? undefined : `${componentLabel} · ${formatBookingMoney(componentAmount)}`;
  const moneyTexts: A2UIComponent[] = [
    ...(totalKobo === undefined ? [] : [{ id: "card-payment-total", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.allInStayTotal, formatBookingMoney(totalKobo)), variant: "h3" as const }]),
    ...(depositKobo === undefined || depositKobo <= 0 ? [] : [{ id: "card-payment-deposit", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.refundableSecurityDeposit, formatBookingMoney(depositKobo)) }]),
    ...(showTotalRequirement ? [{ id: "card-payment-amount-due", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.amountDueNow, formatBookingMoney(facts.amountDueNowKobo)) }] : []),
    ...(componentText ? [{ id: "card-payment-component", component: "Text" as const, text: componentText }] : []),
  ];
  const money: readonly A2UIComponent[] = totalKobo === undefined ? moneyTexts : [
    priceBreakdownComponent("card-payment", {
      ...(componentNext === undefined ? {} : { next: componentNext }),
      total: formatBookingMoney(totalKobo),
      ...(depositKobo === undefined || depositKobo <= 0 ? {} : { deposit: formatBookingMoney(depositKobo) }),
      ...(showTotalRequirement ? { due: formatBookingMoney(facts.amountDueNowKobo) } : {}),
    }),
    ...moneyTexts.filter((component) => component.id === "card-payment-component" && componentNext === undefined),
  ];
  const moneyIds = money.map((component) => component.id);
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: [
      "card-payment-title", "card-payment-status", ...ticket.ids,
      ...moneyIds,
      ...(schedulePeriods.length > 0 ? ["card-payment-schedule-heading", ...(currentPeriodText === undefined ? [] : ["card-payment-current-period"]), ...scheduleIds, "card-payment-first-period"] : []),
      "card-payment-deadline", ...(stage ? ["card-payment-progress"] : []), "card-payment-content", "card-payment-actions",
    ] },
    { id: "card-payment-title", component: "Text", text: copy.title, variant: "h2" },
    { id: "card-payment-status", component: "Text", text: copy.status },
    ...ticket.components,
    ...money,
    ...(schedulePeriods.length > 0 ? [
      { id: "card-payment-schedule-heading", component: "Text" as const, text: GUEST_FACT_LABELS.paymentSchedule, variant: "h3" as const },
      ...(currentPeriodText === undefined ? [] : [{ id: "card-payment-current-period", component: "Text" as const, text: currentPeriodText }]),
      ...schedulePeriods.map((text, index) => ({ id: `card-payment-period-${index}`, component: "Text" as const, text })),
      { id: "card-payment-first-period", component: "Text" as const, text: GUEST_FACT_LABELS.firstPeriodOnly, variant: "caption" as const },
    ] : []),
    { id: "card-payment-deadline", component: "Text", text: formatBookingDeadline(facts.paymentWindowExpiresAt) },
    ...(stage ? [{ id: "card-payment-progress", component: "Text" as const, text: bookingProgressText(stage) }] : []),
    { id: "card-payment-content", component: "Text", text: copy.content },
    { id: "card-payment-actions", component: "Row", children: action ? ["card-payment-action"] : [] },
    ...(action ? [
      { id: "card-payment-action", component: "Button" as const, child: "card-payment-action-label", variant: "primary" as const, action: { event: { name: action.type === "verify_return" ? CARD_PAYMENT_VERIFY_RETURN_EVENT : CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, context: { artifactId: artifact.id, offerId: facts.offerId, expectedStatus: action.expectedStatus, expectedPurpose: action.expectedPurpose ?? "stay", ...(facts.journeyVersion === undefined ? {} : { expectedJourneyVersion: facts.journeyVersion }), ...(facts.journeyStage === undefined ? {} : { expectedStage: facts.journeyStage }), depositPolicyVersion: facts.depositPolicyVersion ?? "", projectionVersion: artifact.projectionVersion } } }, accessibility: { label: actionLabel } },
      { id: "card-payment-action-label", component: "Text" as const, text: actionLabel },
    ] : []),
  ];
  // Weaver catalogues issue 04 (ADR 0102): typed StayTicket / PriceBreakdown in place of label-prefixed Texts.
  return surfaceMessages(surfaceId, SHORTLET_BOOKING_CATALOG_ID, components);
}
