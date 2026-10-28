/**
 * Issue 06 (ADR 0070): one mutating run per assistant thread.
 *
 * A typed turn awaits the model, so another request on the same thread can run in the middle of it. The owner decision is
 * refusal, not queueing: a second mutating event on a thread whose run is still in progress is refused with the closed
 * code `THREAD_BUSY`, and the client retries. Read-only calls never consult this lock.
 *
 * Where the lock lives. Production builds one runtime and one environment per browser session (guest-server.ts,
 * `runtimeForSession`), and every one of those environments receives the same store handle (`environment.database`). The lock
 * is therefore keyed on that shared store handle, not on the environment or the runtime, so a second session's runtime over the
 * same store is refused too. The Durable Object caches its handler for its whole life (shortlet-pilot-do.ts, `??=`), so one
 * store handle serves every request to that tenant object. The flag is set and cleared inside that one object, and an evicted
 * object's in-flight requests end with it, so no flag outlives the run that set it.
 *
 * The lock is taken synchronously: `beginThreadRun` checks and sets the flag in one step, before the first await of a run. It is
 * released in `finally`, so it clears after an answer, a refusal, a thrown error, a deadline stop and a stuck call bounded by the
 * runtime's outer timeout.
 */

/** The closed refusal code for a second mutating event on a thread with a run in progress. */
export const THREAD_BUSY_CODE = "THREAD_BUSY";

/** The fixed platform copy for the refusal. The client retries; no model text is involved. */
export const THREAD_BUSY_MESSAGE = "The assistant is still answering this conversation. Try again in a moment.";

/** The active runs per store handle, keyed by thread id. A `WeakMap` so a discarded store releases its registry. */
const ACTIVE_RUNS = new WeakMap<object, Set<string>>();

/** True while a mutating run on `threadId` is in progress against this store. */
export function threadRunActive(store: object, threadId: string): boolean {
  return ACTIVE_RUNS.get(store)?.has(threadId) === true;
}

/**
 * Starts a mutating run on the thread against this store. Returns the release function, or undefined when a run is already in
 * progress (the caller refuses with `THREAD_BUSY`). The release is idempotent, so a `finally` may call it after any exit path.
 */
export function beginThreadRun(store: object, threadId: string): (() => void) | undefined {
  let active = ACTIVE_RUNS.get(store);
  if (!active) {
    active = new Set<string>();
    ACTIVE_RUNS.set(store, active);
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
