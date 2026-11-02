# Assistant: change a Request Draft from chat

Status: needs-triage
Type: AFK
Blocked by: 01, 04, 05
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`guest-chat-first-ux` issue 14 lets a guest say "make it 3 nights" on a draft and get a re-quoted replacement to accept or keep (`#proposeDraftReplacement`, `shortlet-app.ts:4464`; accept and keep at :4698, :4809; `test/guest-draft-revision.test.ts`, 11 tests, none with the assistant). `#proposeDraftReplacement` runs only after the assistant has declined the turn (`shortlet-app.ts:952`), so with the assistant on, a guest cannot change a draft by chat. The assistant's "replacement" (`assistant-state.ts:60`) is proposal supersession, not draft revision.

## What to build

- When the task state holds a current draft and the guest changes stay facts, the pack produces the same draft-replacement surface (re-quote, accept, keep) through the existing handlers, not a new agent-only path (ADR 0080).
- Relative dates in the change go through the issue 04 show-back first, as the deterministic path does.
- Accept goes through the platform action gate (ADR 0072).

## Acceptance criteria

- [ ] AC1: "make it 3 nights" on a draft shows the re-quoted replacement with accept and keep.
- [ ] AC2: Accept replaces the draft; keep changes nothing.
- [ ] AC3 failure path: a stay over the limit, or a party the apartment can't take, is refused and the draft is unchanged.
- [ ] AC4 failure path: a tampered or stale accept returns `STALE_SURFACE`; a price change before accepting re-proposes.
- [ ] AC5: Relative dates are confirmed before the replacement is proposed.
- [ ] AC6: Each of the 11 deterministic draft-revision tests has an assistant twin with a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Same command and handlers on both paths | AC1, AC2, AC6 |
| 0072 | Accept through the action gate | AC2 |
| 0074 | Fail-closed surfaces | AC4 |
| 0015 | Re-quote is all-in | AC1 |
| 0106 (amended) | Date authority | AC5 |

## Comments
