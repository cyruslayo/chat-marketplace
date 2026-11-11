/**
 * Issue 21 (ADR 0106; guideline §6 turn behaviour, §12 unknown outcome): a user cancel and the turn timeout both end the
 * browser wait. `AbortSignal.any` is newly available, so a manual controller is the fallback.
 */
export function combinedAbortSignal(
  user: AbortSignal,
  timeoutMs: number,
  any: ((signals: AbortSignal[]) => AbortSignal) | undefined = typeof AbortSignal.any === "function" ? (signals) => AbortSignal.any(signals) : undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (any !== undefined) return any([user, timeout]);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (user.aborted) abort();
  else user.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
