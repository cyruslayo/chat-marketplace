import type { PaymentContinuationRejectedEvent } from "../../local-guest/src/guest-server.js";
import { PAYSTACK_PROVIDER_STATUS_CLASSES, type PaystackProviderStatusClass } from "../../../packages/platform-core/src/payments/paystack.js";

/** Fixed Workers Logs event name for a rejected payment continuation (ADR 0075). */
export const PAYMENT_CONTINUATION_REJECTED_LOG_EVENT = "payment_continuation_rejected";

/**
 * Writes one structured line for a rejected payment continuation. The line carries the fixed event name and the closed
 * reason only: no offer id, URL, reference, contact, cookie, secret or provider text (ADR 0075, ADR 0087). A provider
 * start failure (`provider_start_failed`) adds its closed HTTP-status class; any other reason, or a class outside the
 * closed list, omits it.
 */
export function logPaymentContinuationRejected(
  event: PaymentContinuationRejectedEvent,
  write: (line: string) => void = (line) => console.log(line),
): void {
  const statusClass = providerStatusClassForLog(event);
  write(JSON.stringify({ event: PAYMENT_CONTINUATION_REJECTED_LOG_EVENT, reason: event.reason, ...(statusClass === undefined ? {} : { statusClass }) }));
}

function providerStatusClassForLog(event: PaymentContinuationRejectedEvent): PaystackProviderStatusClass | undefined {
  const candidate: unknown = event.statusClass;
  if (event.reason !== "provider_start_failed") return undefined;
  return (PAYSTACK_PROVIDER_STATUS_CLASSES as readonly unknown[]).includes(candidate) ? (candidate as PaystackProviderStatusClass) : undefined;
}
