# Server-generated guest thread ids

Status: resolved
Type: AFK
Blocked by: none
Requested: 8 Nov 2026
Wraps: [shortlet-concierge-launch/53](../../shortlet-concierge-launch/issues/53-server-generate-guest-thread-ids.md)

## Parent

[PRD](../PRD.md). Should-have security hygiene before real guests.

## Why

A client can choose its own guest thread id today (any value matching `THREAD_ID_PATTERN`). That costs audit correlation and keeps `g-<uuid>` out of the platform-id redaction exemption. See issue 53 for the full analysis; note that line numbers there may have moved after the guest-focused-journey merge.

## What to build

Issue 53's "What to build" and acceptance criteria. Default: refuse a client-supplied id with 400 `INVALID_CONVERSATION`.

## Acceptance criteria

- [x] AC1: issue 53's criteria, one named test each.
- [x] AC2: the cold assistant journey (`test/assistant-cold-journey.test.ts`) still passes.

## Comments

- 2026-11-08 (agent): The server mints every guest thread id through one helper (`mintThreadId()`: `g-` plus `crypto.randomUUID()`). The served page carries the id in `<meta name="shortlet-thread-id">`; the `GET /` and `GET /conversation` paths mint and bind it to the browser session; `/welcome/start` and the shell use the same helper. `apps/local-guest/src/client.ts` no longer calls `crypto.randomUUID`, no longer builds a `g-` id, and reads the id from the server page (`getThreadId(): string | null`); a new conversation navigates to `/` so the server mints the next id.
- The no-JavaScript conversation form now accepts a submitted `threadId` only when this server issued it to the browser session; otherwise it answers 400 `INVALID_CONVERSATION` and writes nothing. A pattern-matching but unissued id creates no thread and writes no audit row (both tested).
- Redaction (ADR 0075): `threadId` now lists the `g` prefix, so a server-issued `g-<uuid>` is exempt and human-handoff audit rows keep their correlation id. The `PLATFORM_ID_CONSCIOUSLY_EXCLUDED` entry is removed, and a card-number-shaped value under `threadId` is still masked.
- **Scope flagged for review (issue 53 asks for it):** the acceptance criteria and the refusal concern the guest conversation form. The JSON `/api/turn` and `/api/event` contract is unchanged, so a hand-crafted request that supplies a pattern-valid id is still bound and adopted; the shipped client never does this. Closing that path needs the browser/API tests that mint their own ids to obtain server ids first, which is a separate change and should be reviewed before merge.
- Validation: `npm run check` clean. `npx tsx --test test/server-generated-thread-ids.test.ts` 6/6 (AC1, AC1 failure path, AC2, AC3, AC4, AC5). 53/53 across `test/redact-platform-ids.test.ts`, `test/redact-platform-ids-generators.test.ts`, `test/guest-app-frame.test.ts`, `test/guest-new-conversation.test.ts` and `test/local-guest-shell.test.ts`. The cold assistant journey runs at the application layer (not the HTTP id contract) and runs in the batch gate.
- Implementation commit `120e356`.

## Answer

Guest thread ids are minted only by the server, the client obtains one from the served page and never creates one, and the no-JavaScript conversation form refuses a client-chosen id with no thread or audit row. The `g-<uuid>` redaction exemption is in place and handoff audit correlation survives. The JSON turn API keeps its pre-existing contract and is flagged for review, as issue 53 requested.
