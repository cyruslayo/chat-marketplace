/**
 * Issue 06 (ADR 0070): one mutating run per assistant thread.
 *
 * A typed turn awaits the model, so another request on the same thread can run in the middle of it. The owner decision is
 * refusal, not queueing: a second mutating event on a thread whose run is still in progress is refused with the closed
 * code `THREAD_BUSY`, and the client retries. Read-only calls never consult this lock.
 *
 * Where the lock lives. The runs are keyed by the tenant's environment object (the store and the runtime's owner), not by a
 * runtime instance, so every runtime built over the same store shares one registry. On Cloudflare the runtime is cached for the
 * lifetime of the Durable Object instance (`shortlet-pilot-do.ts`, `#runtime ??=`), and that instance also holds the in-flight
 * request, so the flag is set and cleared inside one object. When an instance is evicted, its in-flight requests end with it, so
 * no stale flag outlives the run that set it. The flag is cleared in `finally`, including after a thrown error or a deadline stop.
 *
 * The lock is held synchronously: `beginThreadRun` checks and sets the flag in one step, before the first await of a run.
 */

/** The closed refusal code for a second mutating event on a thread with a run in progress. */
export const THREAD_BUSY_CODE = "THREAD_BUSY";

/** The fixed platform copy for the refusal. The client retries; no model text is involved. */
export const THREAD_BUSY_MESSAGE = "The assistant is still answering this conversation. Try again in a moment.";

const ACTIVE_RUNS = new WeakMap<object, Set<string>>();

/** True while a mutating run on `threadId` is in progress under this tenant owner. */
export function threadRunActive(owner: object, threadId: string): boolean {
  return ACTIVE_RUNS.get(owner)?.has(threadId) === true;
}

/**
 * Starts a mutating run on the thread. Returns the release function, or undefined when a run is already in progress (the caller
 * refuses with `THREAD_BUSY`). The release is idempotent, so a `finally` may call it after any exit path.
 */
export function beginThreadRun(owner: object, threadId: string): (() => void) | undefined {
  let active = ACTIVE_RUNS.get(owner);
  if (!active) {
    active = new Set<string>();
    ACTIVE_RUNS.set(owner, active);
  }
  if (active.has(threadId)) return undefined;
  active.add(threadId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(threadId);
  };
}
