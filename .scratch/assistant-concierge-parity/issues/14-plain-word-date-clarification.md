# Replace the YYYY-MM-DD clarification and its keyword check

Status: resolved
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

- `GUEST_ASSISTANT_COPY.dateClarification` is "Please give me the check-in date as YYYY-MM-DD." (`guest-content.ts:29`). Guests don't write ISO dates, and the server already reads "20 November".
- `renderShortletReply` picks it with a keyword regex: `/\b(next friday|next week|tomorrow|next month)\b/` (`shortlet-assistant-pack.ts:958`). That is a keyword path in the reply, and it misses every other relative phrase.

## What to build

- Use the plain-word copy already used for rejected planner dates (`datesClarification`) or a shorter variant, in `guest-content.ts`.
- Remove the keyword regex; choose the clarification from the reply plan and the tool outcome only.
- Update `SHORTLET_PROMPT_SECTION` so it no longer asks the model to request YYYY-MM-DD (until issue 04 lands: "ask for the day and month").

## Acceptance criteria

- [ ] AC1: No guest-facing string contains "YYYY-MM-DD".
- [ ] AC2: A relative date turn on the assistant path gets the plain-word clarification.
- [ ] AC3: `renderShortletReply` has no phrase list for dates.
- [ ] AC4: `test/shortlet-assistant-evals.test.ts` (line 95 and Eval 18) is updated to the new copy, and still asserts that no search runs.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | No deterministic in-scope fast path; dated clarification on rejection | AC2, AC3 |
| 0077 | Copy from one module | AC1 |

## Comments

### Implementation plan and ADR table (agent, 2 Nov 2026)

Read: ADR 0106 (all amendments), 0077, 0075, 0099, 0092, 0093, 0080; `docs/agents/issue-tracker.md` Definition of Done.

| ADR | Constraint | Code path / AC |
|---|---|---|
| 0106 | Date authority fail closed; a rejected planner date is a `tool_denial` that returns `ok: true` with the pack's dated clarification, keeps the guest message, runs no search | `assistant-runtime.ts` tool_denial branch uses `pack.dateClarification`; AC2 |
| 0106 | No deterministic in-scope fast path; no keyword shortcut around the model | `renderShortletReply` date regex removed (AC3); `scripted-assistant-model.ts` relative-date text-only branch replaced by a planner tool call (AC2/AC4) |
| 0106 | Model selects typed kinds; server supplies wording | Wording comes from `GUEST_ASSISTANT_COPY` only (AC1) |
| 0077 | Guest copy comes from one module | `guest-content.ts`: `dateClarification` removed, `datesClarification` survives (AC1) |
| 0075 | No guest text or ids in logs; internal error messages stay out of guest copy | `resolveCheckInDate` internal error text reworded to "day and month" (AC1) |
| 0099 | Shortlet logic stays in the pack, never the runtime | Only `shortlet-assistant-pack.ts` and the shortlet scripted fixture change (AC3) |
| 0080 | Deterministic parity: no agent-only contract | Not touched; no state change |

Plan:
- AC1 test: walk every exported value of `apps/web-agent/src/guest-content.ts` and assert no string contains `YYYY-MM-DD`; also assert the reply of a rejected relative-date turn lacks it.
- AC2 test: cold restore before each event (`restartedDatedApp`), assistant runtime on, `LIVE_LIKE_CLOCK`, `stagingGuest: true`, fresh thread, guest writes "next Friday"; the planner proposes `checkIn` 2026-11-20 which the guest did not write, so `tool_denial` gives `datesClarification` and no search runs.
- AC3 test: slice `renderShortletReply` from the source and assert no `next friday|next week|next month|tomorrow`.
- AC4: update the evals test's line 98 regex and Eval 18.

Open point (reported, not decided here): a relative-date turn where the planner makes no search and returns no tool call still falls to `safeClarification` / `stayClarification`, because no date-typed reply kind exists in the closed list. Closing that gap needs a closed `clarify_dates` kind (an ADR 0106 reply-kind decision), not a phrase list.

### Test runs (agent, 2 Nov 2026)

Commands (all with `env -u LLM_API_KEY`):
- `npm run check`: exit 0, zero type errors, worker bundle guard passed.
- `npx tsx --test test/assistant-date-clarification-copy.test.ts`: 3 pass, 0 fail (before the change, AC1 and AC3 failed for the right reason; AC2 already passed because the planner's rejected date already used `datesClarification`).
- `npx tsx --test test/shortlet-assistant-evals.test.ts`: 52 pass, 0 fail.
- `npx tsx --test test/assistant-date-literal-authority.test.ts`: 8 pass, 0 fail.
- `npx tsx --test test/assistant-date-literals.test.ts`: 15 pass, 0 fail.
- `npx tsx --test test/assistant-reply-coverage.test.ts`: 5 pass, 0 fail.
- `npx tsx --test test/assistant-reply-control-outcome.test.ts`: 2 pass, 0 fail.
- `npx tsx --test test/assistant-reply-plan-references.test.ts`: 9 pass, 0 fail.
- `npx tsx --test test/assistant-scope-controls.test.ts`: 38 pass, 0 fail.
- `npx tsx --test test/assistant-turn-date-context.test.ts`: 4 pass, 0 fail.
- `npx tsx --test test/assistant-search-unknowns.test.ts`: 5 pass, 0 fail.
- `npx tsx --test test/assistant-persistent-continuity.test.ts`: 7 pass, 0 fail.
- `npx tsx --test test/assistant-control-metrics.test.ts`: 6 pass, 0 fail.
- `npx tsx --test test/guest-chip-continuity.test.ts`: 6 pass, 0 fail.
- `npx tsx --test test/assistant-cold-journey.test.ts`: 3 pass, 0 fail.
- `npx tsx --test test/demo-openrouter.test.ts`: 7 pass, 0 fail.
- `npx tsx --test test/guest-must-fix-ux.test.ts`: 7 pass, 0 fail.
- Not run: `npm test`, `npm run test:workers` (per-batch gate only).

### Definition of Done

1. Every AC has a dedicated named test: yes (AC1, AC2, AC3 in `test/assistant-date-clarification-copy.test.ts`; AC4 is the updated Eval 18 and line 98 test in `test/shortlet-assistant-evals.test.ts`).
2. Failure paths: AC1 asserts every guest string; AC2 asserts the tool denial keeps the message and runs no search; AC3 asserts the function body.
3. ADRs listed and read: yes, see the table above (0106, 0077, 0075, 0099, 0092, 0093, 0080).
4. No unused injected dependency: no constructor changed.
5. No invented policy string: the only new copy is the existing `datesClarification`; the prompt wording is the owner's "day and month" instruction.
6. No bearer credential or restricted identity in logs: the changed error text is internal (the runtime sends only the pack's dated clarification to the guest) and the diagnostic records only the class name.
7. `npm run check` passes: yes. `npm test` is the batch gate and has not been run for this issue.

## Answer

- `apps/web-agent/src/guest-content.ts`: removed `GUEST_ASSISTANT_COPY.dateClarification`. The pack's `dateClarification` now resolves to `datesClarification` ("I need your check-in and checkout dates before I can search. Please write them with the day, month and year, ...").
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: deleted the relative-date regex branch in `renderShortletReply`; `SHORTLET_PROMPT_SECTION` asks for the day and month in plain words; the internal `resolveCheckInDate` error text now says "Ask the user for the day and month." The model-facing `checkIn` schema description still says YYYY-MM-DD (kept on purpose).
- `apps/local-guest/src/assistant/scripted-assistant-model.ts` (offline fixture): the relative-date branch no longer returns the YYYY-MM-DD sentence. It proposes a `search_stays` with a check-in the guest did not write, so the pack rejects it as a `tool_denial` with the dated clarification. This is how Eval 18 reaches the copy.
- `test/shortlet-assistant-evals.test.ts`: line 98 now asserts "day and month" and no YYYY-MM-DD; Eval 18 asserts `datesClarification`, empty surfaces.
- `test/assistant-date-clarification-copy.test.ts` (new): AC1, AC2, AC3.
- `docs/testing/shortlet-assistant-v1.md`: one sentence changed to plain words.

Open items (not changed):
- The other keyword regexes in `renderShortletReply` (support `/active stay|locked out|access|safety|emergency/` and the stay-clarification `/how many|nights|stay|somewhere|place|lagos|abuja|lekki|ikoyi/`) and the fixture's relative-date regex in `scripted-assistant-model.ts` are the same kind of keyword path. Left in place for the owner to decide.
- Gap: a relative-date turn where the planner makes no search and returns no tool call still gets `safeClarification` or `stayClarification`, because the closed reply-kind list has no date kind. Closing it needs a `clarify_dates` reply kind, which is an ADR 0106 decision for the owner.

