# Bug: the request summary shows made-up nights and party size

Status: resolved
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`propose_request_to_book` builds its summary with `nights ?? 3` and `partySize ?? 1` (`shortlet-assistant-pack.ts:730`). If either is unknown, the guest is shown invented values, against the same file's rule "Never default to one" and ADR 0015 (no invented quote or party size).

## What to build

- The proposal requires known nights and party size (from the task state); if either is missing it is a `tool_denial` with the stay clarification, like `search_stays` (:415).
- The summary uses only known values.

## Acceptance criteria

- [ ] AC1: With nights and party known, the summary shows them.
- [ ] AC2 failure path: with nights unknown, no proposal is created and the stay clarification is returned.
- [ ] AC3 failure path: with party size unknown, the same.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0015 | No invented quote or party size | AC2, AC3 |
| 0106 | Rejected calls are `tool_denial` | AC2, AC3 |

## Comments

### Claim and ADR table (agent, 2 Nov 2026)

Status set to `claimed`. ADRs listed and read (0015, 0106 in full; 0075, 0092, 0093, 0099, 0080 read for the constraints below).

| ADR | Constraint | AC / code path |
|---|---|---|
| 0015 | No invented quote or party size; unknown stay details cannot become a summary value | AC1 summary uses only known nights/party; AC2/AC3 `propose_request_to_book` throws before any mutation |
| 0106 | A proposal missing its stay details is a rejected tool call (`tool_denial`) with the stay clarification, not `CONCIERGE_UNAVAILABLE`; the turn commits no task state | AC2, AC3: `AssistantStayDetailsError` thrown from the pack, caught in `assistant-runtime.ts` (tool_denial branch) |
| 0099 | Shortlet rules live in the pack (`shortlet-assistant-pack.ts`), not the domain-neutral runtime | Guard placed in the pack's proposal case |
| 0075 | No guest text or ids in logs | No logging added |
| 0092, 0093, 0080 | Read for context: extended-stay ranges and guest accounts do not change the proposal rule; the deterministic request path is untouched | No change |

### Red, then green (agent, 2 Nov 2026)

Red run (before the guard; AC1 passing already, AC2/AC3 failing because the proposal was created): the new file was run with the guard absent and the AC2/AC3 failures were `rejected_plan_fallback` with a pending request created, not `tool_denial`.

Commands and counts (all with `env -u LLM_API_KEY`):

| Command | Result |
|---|---|
| `npm run check` (`tsc --noEmit` for root, cloudflare, cloudflare test and tooling, plus the Worker bundle guard) | exit 0, zero errors |
| `npx tsx --test test/assistant-request-summary.test.ts` (new) | 3 / 3 pass (AC1, AC2, AC3) |
| `npx tsx --test test/assistant-booking-journey.test.ts` | 8 / 8 |
| `npx tsx --test test/assistant-search-unknowns.test.ts` | 5 / 5 |
| `npx tsx --test test/assistant-proposal-replacement.test.ts` | 12 / 12 |
| `npx tsx --test test/assistant-proposal-supersession.test.ts` | 16 / 16 |
| `npx tsx --test test/assistant-tool-authorization.test.ts` | 7 / 7 |
| `npx tsx --test test/shortlet-assistant-evals.test.ts` | 52 / 52 |
| `npx tsx --test test/assistant-tool-argument-validation.test.ts` | 13 / 13 |
| `npx tsx --test test/assistant-where-chip.test.ts` (proposes via the planner) | 15 / 15 |
| `npx tsx --test test/assistant-context-isolation.test.ts` (proposes via the planner) | 7 / 7 |
| `npx tsx --test test/assistant-runtime-boundary.test.ts` (proposes via the planner) | 5 / 5 |
| `npx tsx --test test/assistant-cold-journey.test.ts` | 3 / 3 |

Logs: `/tmp/claude-0/-home-user-chat-marketplace/9aa0ba72-1e90-5721-bfa4-48090b0d0cd0/scratchpad/issue15/`.

Full `npm test` and `npm run test:workers` are not run per issue (CLAUDE.md, Test scope); they run once for the batch before merging.

### Definition of Done

1. Every AC has a dedicated named test: yes, one `test()` per AC, names mirror the AC text.
2. Failure paths: AC2 and AC3 assert `assistantControlOutcome` = `tool_denial`, the exact stay clarification, no surface, and no `pendingAction` after a cold restore.
3. ADRs listed and read: yes (table above); the table is re-checked below.
4. No unused injected dependency: no constructor parameters were added.
5. No invented policy: the guard reuses the existing `AssistantStayDetailsError` and `GUEST_ASSISTANT_COPY.stayClarification`; no new guest copy. The thrown message is a developer message, not shown to the guest.
6. No credentials or identity in logs: nothing logged.
7. `npm run check` clean: yes. `npm test` passing: deferred to the batch pre-merge gate per Test scope.

### ADR re-check after implementation

- ADR 0015: the summary prints only `nights` and `partySize` after the guard, with no `?? 3` / `?? 1`. Dates are printed only when both are known. Met.
- ADR 0106: the missing-value case throws `AssistantStayDetailsError` before `selectedStayRef` or the pending action is set. The runtime's `tool_denial` branch commits the thread's prior task state, so nothing is kept. Met.
- ADR 0099: the rule is in `shortlet-assistant-pack.ts`, not the runtime. Met.
- ADR 0075: no logging added. Met.

## Answer

- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`, `propose_request_to_book` case: the nights and party size guard runs right after the shortlist lookup and before any mutation. It throws `AssistantStayDetailsError` when either is not a safe positive integer. The summary uses the guarded values (no `?? 3`, `?? 1`). A new helper `stayDatesClause` adds `for <in> to <out>` only when both dates are known, so an unknown date is never printed as `undefined`.
- `test/assistant-request-summary.test.ts` (new): AC1, AC2, AC3, each on cold-restored applications, the staging clock and a staging-like guest.
- No change to `validateAssistantToolCall`: it returns plain failure codes that the runtime treats as errors, not `tool_denial`, so the single guard lives in the case.

### Deviations and open questions for the owner

- **Check-in is not required.** The AC and the design note name nights and party size. A proposal made with demo dates (no confirmed check-in, as `tool-authorization` AC4 does) still proceeds, and the summary then omits the dates. Requiring a confirmed check-in would be a policy change: owner decision.
- **Chips cannot make nights unknown while dates are known.** A date chip without nights returns `INVALID_CRITERIA`, so the AC2 setup reaches "nights unknown" with no check-in and the guests chip. The guard still checks nights and party separately, so this is a setup detail, not a gap in the guard.
- The design note's line numbers and "validateAssistantToolCall" option were checked: the code is at the lines given, and `validateAssistantToolCall` is not the right place (see above).
