# Prove the thread lock on the Workers pool and let the guest chat retry a busy turn

Status: needs-triage
Type: task
Blocked by: 06
Requested: 28 Oct 2026 (follow-up written by issue 06)
PRD: `../PRD.md`

## Why

Issue 06 adds one mutating run per thread (ADR 0070). Its tests run the real runtime and application in Node over one
store. Two gaps remain, and the owner's decision on issue 06 assumed both:

1. **No Workers-pool test.** Issue 06's question 1 asked for the consequences to be confirmed against the Workers test pool. Issue 06
   did not write that test, and as noted below one cannot be written as a plain spec. The lock is keyed on the shared store handle
   (`environment.database`). Every browser session's runtime over the tenant receives that handle, and the `ShortletPilot` instance
   (`apps/cloudflare/src/shortlet-pilot-do.ts`, `#runtime ??=`) caches its handler while it lives.
2. **The guest chat does not retry.** A second mutating event on a busy thread returns `code: "THREAD_BUSY"` with a fixed copy. The
   owner decided the client retries. The browser does not do that yet (see Today's behaviour).

## Today's behaviour (issue 06, as built)

- The server answers a busy event or turn with HTTP 200 and `{ ok: false, code: "THREAD_BUSY", message }`. It is not a 4xx.
- The browser shows that message as an assistant bubble. The guest's composer text is kept. The browser does **not** retry, and
  it offers no Retry control. The guest must send again by hand.
- The lock is keyed on the shared store handle, so a second browser session on the same tenant is refused too.
- A Workers-pool interleave spec is **not possible** as written: the Worker test binding runs deterministically, so two concurrent
  requests cannot be held inside one `ShortletPilot` instance from a spec. The concurrency proof stays in Node
  (`test/assistant-thread-lock.test.ts` and `test/assistant-session-thread-lock.test.ts`, which hold a real run across a second
  request). Any Workers-level proof needs a harness that can hold a request, which this issue does not build.

## What to build

- A browser retry for `THREAD_BUSY`: the chat client waits briefly and resends the guest's text once, or offers Retry, with the
  guest's text kept. Reuse the existing turn-wait and Retry pattern (ADR 0106 amendment, 27 Oct 2026); no new control outcome.
- Optionally, a Workers-pool harness that can hold one request (only if the owner wants the DO-level proof; see above).

## Acceptance criteria

- The browser shows the busy message, keeps the guest's text in the composer, and does not duplicate the message in the timeline.
- A later send on the same thread, after the run ends, is accepted.
- The browser sends at most one automatic retry, after a short fixed delay that is an engineering setting, and then offers Retry.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0070 | One mutating run per thread; a second is refused, not queued | The refusal the client handles |
| 0079 | Interaction streams are observable and time-bounded | The retry delay and the turn wait |
| 0106 | Closed control outcomes; no invented outcome | The retry reuses the existing Retry path |

## Notes for the owner

- `AGENTS.md` says "every Worker request is a cold restore". The code does not do that. A request reuses its session runtime while
  that runtime is resident (`guest-server.ts`, `runtimeForSession`; the Durable Object caches its handler, `shortlet-pilot-do.ts`).
  Eviction, restart or redeploy rebuilds the runtime from the store, and only then does the restore run. The owner should correct
  that sentence (documentation only; this issue does not edit AGENTS.md).
