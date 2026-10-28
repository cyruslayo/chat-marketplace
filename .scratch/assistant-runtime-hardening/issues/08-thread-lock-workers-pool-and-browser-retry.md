# Prove the thread lock on the Workers pool and let the guest chat retry a busy turn

Status: needs-triage
Type: task
Blocked by: 06
Requested: 28 Oct 2026 (follow-up written by issue 06)
PRD: `../PRD.md`

## Why

Issue 06 adds one mutating run per thread (ADR 0070). Its tests run the real runtime and application in Node over one
store. Two gaps remain, and the owner's decision on issue 06 assumed both:

1. **No Workers-pool test.** Issue 06's question 1 asked for the consequences to be confirmed against the Workers test pool
   (`apps/cloudflare/test/`). Issue 06 did not write that test. The lock is per tenant environment, and on Cloudflare that is
   the `ShortletPilot` instance (`apps/cloudflare/src/shortlet-pilot-do.ts`, `#runtime ??=`). Nothing yet proves two concurrent
   requests to one instance are refused on the real object.
2. **The guest chat does not retry.** A second mutating event on a busy thread returns `code: "THREAD_BUSY"` with the fixed
   copy "The assistant is still answering this conversation. Try again in a moment." The owner decided the client retries. The
   browser does not do that yet, so the guest sees the copy and must act.

## What to build

- A spec in `apps/cloudflare/test/` that sends two `POST /api/turn` requests for one thread to one `ShortletPilot` instance, the
  second while the first awaits the model (a held model response). The second returns `THREAD_BUSY`, the first completes, and a
  later turn on the same thread is accepted. Run it with `npm run test:workers -- <spec path>`.
- A browser retry for `THREAD_BUSY`: the chat client waits briefly and resends the guest's text once, or offers Retry, with the
  guest's text kept. Reuse the existing turn-wait and Retry pattern (ADR 0106 amendment, 27 Oct 2026); no new control outcome.

## Acceptance criteria

- A two-request Workers spec names the refusal, the completion of the first turn and the accepted later turn.
- A busy refusal leaves the guest's typed text in the input and does not duplicate the message in the timeline.
- The browser sends at most one automatic retry, after a short fixed delay that is an engineering setting, and then offers Retry.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0070 | One mutating run per thread; a second is refused, not queued | The refusal the client handles |
| 0079 | Interaction streams are observable and time-bounded | The retry delay and the turn wait |
| 0106 | Closed control outcomes; no invented outcome | The retry reuses the existing Retry path |

## Notes for the owner

- `AGENTS.md` says "every Worker request is a cold restore". The code does not do that for a warm instance: the runtime is
  cached for the life of the Durable Object (`shortlet-pilot-do.ts`), and a restore runs only when the runtime does not hold the
  thread. Restore happens after eviction or redeploy. The owner should correct that sentence (documentation only).
