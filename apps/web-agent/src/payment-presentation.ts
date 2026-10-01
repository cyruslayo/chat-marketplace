import type { CardPaymentArtifact } from "../../web/src/card-payment-artifact.js";
import { guestPaymentStatus } from "./booking-presentation.js";
import { GUEST_GLOSSARY, guestWaitingCopy } from "./guest-content.js";

type CardPaymentFacts = CardPaymentArtifact["facts"];

/** The payment states the guest is told about; the processing stages are the card checkout's grace period (ADR-0044). */
export function isCardPaymentProcessing(facts: CardPaymentFacts): boolean {
  return facts.journeyStage === "stay_payment_processing" || facts.journeyStage === "deposit_payment_processing";
}

/** The heading, status pill and explanation of a card payment, shared by the chat surface and the payment page. */
export function cardPaymentCopy(facts: CardPaymentFacts): { readonly title: string; readonly status: string; readonly content: string } {
  const processing = isCardPaymentProcessing(facts);
  const detail = guestPaymentStatus(facts.status, processing);
  const payable = facts.status === "ready" || facts.status === "deposit_required";
  return {
    title: facts.status === "confirmed" ? "Booking confirmed" : processing ? "Payment being checked" : payable ? "Payment required" : facts.status === "reconciliation_required" || facts.status === "compensation_pending" ? "Payment under review" : "Payment status",
    status: facts.status === "confirmed" ? "Payment verified" : processing ? "Payment processing" : facts.status === "ready" ? "Secure checkout is available" : facts.status === "deposit_required" ? "Stay payment verified" : detail.label,
    content: facts.status === "confirmed"
      ? `${detail.detail} Booking reference is available in your booking details.`
      : processing
        ? "We’re checking the payment result. Don’t submit another payment while it’s pending."
        : facts.status === "deposit_required"
          ? `Pay the ${GUEST_GLOSSARY.refundableSecurityDeposit} to complete the booking.`
          : facts.status === "ready"
            ? `The ${GUEST_GLOSSARY.refundableSecurityDeposit} is charged separately when one applies.`
            : detail.detail,
  };
}

/** Presentation only: what the shared payment screen shows around the ticket and breakdown (ADR-0077). */
export interface PaymentScreenContent {
  readonly state: "ready" | "handoff" | "closed";
  readonly title: string;
  readonly status: string;
  readonly tone: "success" | "warning" | "danger" | "neutral";
  /** Set only while the Payment Window is open and a payment is still due (ADR-0044). */
  readonly deadlineIso?: string;
  readonly serverNow: string;
  readonly explanation: string;
  readonly steps: readonly string[];
  /** The payment page, where the Guest chooses another way to pay (offered only while a card checkout is pending). */
  readonly choosePath?: string;
}

export function paymentScreenContent(artifact: CardPaymentArtifact, now: Date, paymentPath: string, operatorName?: string): PaymentScreenContent {
  const facts = artifact.facts;
  const copy = cardPaymentCopy(facts);
  const waiting = ["ready", "checkout_initiated", "deposit_required"].includes(facts.status) && !isCardPaymentProcessing(facts) && Date.parse(facts.paymentWindowExpiresAt) > now.getTime();
  return {
    state: facts.status === "ready" || facts.status === "deposit_required" ? "ready" : facts.status === "checkout_initiated" && waiting ? "handoff" : "closed",
    title: copy.title,
    status: copy.status,
    tone: facts.status === "confirmed" ? "success" : facts.status === "expired" || facts.status === "failed" ? "danger" : waiting || isCardPaymentProcessing(facts) ? "warning" : "neutral",
    ...(waiting ? { deadlineIso: facts.paymentWindowExpiresAt } : {}),
    serverNow: now.toISOString(),
    explanation: copy.content,
    steps: waiting ? guestWaitingCopy("payment-window", operatorName).outcomes : [],
    ...(facts.status === "checkout_initiated" && waiting ? { choosePath: paymentPath } : {}),
  };
}
