# Make assistant thread state durable and enforce one mutating run per thread

Status: needs-triage
Type: research
Blocked by: 04
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`AssistantRuntime` keeps every thread in an in-memory `Map` (`#threads`, `apps/local-guest/src/assistant/assistant-runtime.ts` line 132): conversation history, task state, active and superseded surfaces, pending actions. On Cloudflare the runtime lives inside the per-tenant `ShortletPilot` Durable Object (`apps/cloudflare/src/shortlet-pilot-do.ts`, through `createGuestRequestHandler`). Two consequences, not yet confirmed by a test:

1. **State is lost when the object is evicted or redeployed.** A guest mid-conversation loses their shortlist, open surfaces and any pending confirmation. Domain state (requests, bookings, payments) is safe because it lives in the domain services; the conversation is not.
2. **Two turns on one thread can overwrite each other.** `handleTurn` clones the thread, awaits the model (an outgoing fetch, during which a Durable Object accepts other requests), then commits. Two tabs sending at once both commit, and the later one silently wins. ADR 0070 requires only one mutating run per thread.

The Cloudflare Agents SDK's useful idea is one Durable Object per conversation with its own storage. The repo can take the idea without the package, whose built-in state and chat history would cut across ADR 0070 and 0081.

## Questions to answer

1. Confirm or refute both consequences with a test against the Workers test pool (`apps/cloudflare/test/`).
2. Pick the smallest fix. Candidates:
   - **A. Per-thread lock plus thread state in the tenant object's SQLite.** A second turn on a busy thread is refused (or queued) with a stable code; the thread is loaded at turn start and saved by issue 04's `TurnTransaction.commit()`. Smallest change; all threads stay in one object.
   - **B. One Durable Object per thread** (`idFromName` on the thread id), calling the tenant object for domain operations. Isolation and per-thread scale, but a new binding, a cross-object hop per tool call, and ADR 0101 hosting changes.
   Recommendation to test first: A. Move to B only if measured load or isolation needs it.
3. What retention applies to saved conversation history? ADR 0075 proposes 30-day transient and 180-day conversational periods, still provisional. The owner decides which applies.
4. Does any of this need an ADR or an amendment to ADR 0101?

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0070 | One mutating run per thread; a thread never owns domain state; reconnect resumes without a new run | Lock; saved state is interaction state only |
| 0075 | Data minimisation; provisional retention periods | What is saved and for how long |
| 0079 | Durable staging and replay are host-owned | Saved thread state is part of that host responsibility |
| 0081 | Durable replay and recovery stay platform responsibilities, not Weaver's | No Weaver types in saved state |
| 0095, 0101 | Cloudflare hosting and multi-domain object layout | Option B changes the layout |

## Answer

(Write the findings, the chosen option and the follow-up task issues here, then resolve.)

## Comments

### Reviewer finding (28 Oct 2026): a confirm can resurrect an executed proposal during an in-flight turn

Not fixed in issue 03. It needs one mutating run per thread (ADR 0070), which is this issue's scope.

Probe (reviewer): a typed turn is in flight, a confirm for the same proposal lands while it runs. `handleTurn` clones the task state at `assistant-runtime.ts` (`let candidateTaskState = cloneTaskState(thread.taskState)`, about line 692), and the clone is committed as a whole at the end of the turn (about lines 1159 and 1207). The confirm executes the proposal and commits, then the in-flight turn commits its older clone, so the executed proposal is restored as pending. A later typed yes can then send the request again, and the stale card is live again.

Required by this issue: serialise mutating turns per thread (one active run; a second mutating event waits or is refused), and commit a task-state change as a delta, not as a whole clone, so an earlier clone cannot restore an executed action. Covered by a test that interleaves a confirm inside a planner round.
