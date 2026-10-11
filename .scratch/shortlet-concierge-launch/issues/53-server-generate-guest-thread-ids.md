# Server-generate guest thread ids so the client cannot choose them

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 11 Oct 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

The guest thread id is partly client-chosen, which costs audit correlation and blocks an exemption.

- `apps/local-guest/src/guest-server.ts:585` defines `THREAD_ID_PATTERN = /^g-[a-f0-9-]{6,64}$/`. Any value that matches it is accepted.
- The conversation form handler accepts a client-supplied `threadId` (`guest-server.ts:9270-9281`): a non-empty submitted id is checked only against the pattern and then used as the thread id. The server generates `g-${crypto.randomUUID()}` only when the field is empty (`:9280`).
- The client generates the ids too: `apps/local-guest/src/client.ts:186` and `:2472`.
- Because the id is client-chosen, `g-<uuid>` is consciously excluded from the platform-id exemption: `PLATFORM_ID_CONSCIOUSLY_EXCLUDED` in `packages/platform-core/src/redaction.ts:65-75` (the reason cites `guest-server.ts:578`; that line has moved to 585, and the comment should be updated with this fix). Exempting it would let a client carry a card number under an exempt key.
- Effect: human-handoff audit rows keyed by `threadId` (`packages/platform-core/src/human-handoff.ts:38-49`) mask about 0.13% of guest thread ids, so those rows lose correlation (issue 50, Why and Follow-ups; the test `Guest thread ids (g-<uuid>) are not exempt under threadId` at `test/redact-platform-ids.test.ts:295` pins the current behaviour).

## What to build

- The server mints every guest thread id (`g-` plus a server-generated v4 UUID, as the existing `guest-server.ts:9280` path already does). A thread id supplied by the client is refused or ignored, not adopted. Choose refuse (400 `INVALID_CONVERSATION`, as the existing pattern check does) unless the human decides otherwise.
- Remove the client-side minting (`client.ts:186`, `:2472`). The client must learn the id from the server response and never create one.
- Keep `THREAD_ID_PATTERN` only as a check on values the server itself issued (or delete it if nothing else reads it).
- After the server-only path is in place and tested, add `g` to the `threadId` row of the exemption table (`PLATFORM_ID_CONSCIOUSLY_EXCLUDED` moves to `PLATFORM_ID_PREFIXES_BY_KEY`) and update `test/redact-platform-ids.test.ts:295`, so that `g-<uuid>` under `threadId` is exempt.
- Flag for review before merge: this changes the guest request contract (a client that sends its own `threadId` now gets an error), and it changes which rows exist for in-flight conversations. The reviewer should confirm the refuse-versus-ignore choice and whether existing `g-` ids in the database need a migration (none is written here).

## Acceptance criteria

- [ ] AC1: A guest conversation form submitted with a client-chosen `threadId` is refused and creates no thread.
- [ ] AC1 failure path: a `threadId` that matches the old pattern but was not issued by the server is refused, with no audit row written.
- [ ] AC2: Every guest thread id issued by the server is `g-` plus a v4 UUID generated with `crypto.randomUUID()` on the server.
- [ ] AC3: The client never generates a thread id; the client flow in `client.ts` obtains it from the server response.
- [ ] AC4: After the change, a `g-<uuid>` thread id under `threadId` is exempt in the redactor (test at `test/redact-platform-ids.test.ts:295` is updated to assert the exemption); a card number placed in a `threadId` value is still masked.
- [ ] AC5: The human-handoff audit rows for a guest thread keep the thread id intact (regression test in the handoff audit suite).

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0004 | Backend owns authoritative state | Server-minted ids (AC2) |
| 0070 | Separate interaction and domain identities | Thread id is an interaction identity (AC1, AC3) |
| 0072 | Consequential actions go through platform commands | The thread-creation command path (AC1) |
| 0075 | Secure and minimise agent-interaction data; one redactor | `redaction.ts:65-75` change (AC4); no second redactor |
| 0080 | Deterministic parity | Chat and standalone conversation paths use the same server-issued id (AC3) |

## Comments

- 11 Oct 2026, filed from issue 50 (follow-up "THREAD_ID_PATTERN", and the consciously-excluded row). The reference line in `redaction.ts:75` is stale: `THREAD_ID_PATTERN` is at `guest-server.ts:585` on `origin/main` 8b23923, not 578. Submitted-id handling is at `guest-server.ts:9270-9281`, not 9178-9189.
- Behaviour change flagged for review: a client-chosen `threadId` will be refused. The reviewer must confirm before merge.
