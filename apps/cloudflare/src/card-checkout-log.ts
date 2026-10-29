import type { CardCheckoutFailedEvent } from "../../local-guest/src/shortlet-app.js";
import { PAYSTACK_PROVIDER_STATUS_CLASSES, type PaystackProviderStatusClass } from "../../../packages/platform-core/src/payments/paystack.js";

/** Fixed Workers Logs event name for a failed chat card start (ADR 0075). */
export const CARD_CHECKOUT_FAILED_LOG_EVENT = "card_checkout_failed";

/**
 * Writes one structured line for a failed chat card start. The line carries the fixed event name and the closed reason
 * only: no offer id, URL, reference, contact, cookie, secret or provider text (ADR 0075, ADR 0087). A Paystack rejection
 * (`provider_rejected`) adds its closed HTTP-status class; any other reason, or a class outside the closed list, omits it.
 */
export function logCardCheckoutFailed(
  event: CardCheckoutFailedEvent,
  write: (line: string) => void = (line) => console.log(line),
): void {
  const statusClass = providerStatusClassForLog(event);
  write(JSON.stringify({ event: CARD_CHECKOUT_FAILED_LOG_EVENT, reason: event.reason, ...(statusClass === undefined ? {} : { statusClass }) }));
}

function providerStatusClassForLog(event: CardCheckoutFailedEvent): PaystackProviderStatusClass | undefined {
  const candidate: unknown = event.statusClass;
  if (event.reason !== "provider_rejected") return undefined;
  return (PAYSTACK_PROVIDER_STATUS_CLASSES as readonly unknown[]).includes(candidate) ? (candidate as PaystackProviderStatusClass) : undefined;
}
