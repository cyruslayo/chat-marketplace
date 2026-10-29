import type { CardCheckoutFailedEvent } from "../../local-guest/src/shortlet-app.js";

/** Fixed Workers Logs event name for a failed chat card start (ADR 0075). */
export const CARD_CHECKOUT_FAILED_LOG_EVENT = "card_checkout_failed";

/**
 * Writes one structured line for a failed chat card start. The line carries the fixed event name and the closed reason
 * only: no offer id, URL, reference, contact, cookie, secret or provider text (ADR 0075, ADR 0087).
 */
export function logCardCheckoutFailed(
  event: CardCheckoutFailedEvent,
  write: (line: string) => void = (line) => console.log(line),
): void {
  write(JSON.stringify({ event: CARD_CHECKOUT_FAILED_LOG_EVENT, reason: event.reason }));
}
