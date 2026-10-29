import type { PaymentContinuationRejectedEvent } from "../../local-guest/src/guest-server.js";

/** Fixed Workers Logs event name for a rejected payment continuation (ADR 0075). */
export const PAYMENT_CONTINUATION_REJECTED_LOG_EVENT = "payment_continuation_rejected";

/**
 * Writes one structured line for a rejected payment continuation. The line carries the fixed event name and the closed
 * reason only: no offer id, URL, reference, contact, cookie, secret or provider text (ADR 0075, ADR 0087).
 */
export function logPaymentContinuationRejected(
  event: PaymentContinuationRejectedEvent,
  write: (line: string) => void = (line) => console.log(line),
): void {
  write(JSON.stringify({ event: PAYMENT_CONTINUATION_REJECTED_LOG_EVENT, reason: event.reason }));
}
