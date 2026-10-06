# Extract the owner request handler

Status: ready-for-agent
Type: task
Blocked by: 04b, 08a
Branch: `infra/cf-08b-owner-handler`
Requested: 2 Oct 2026
Unlocks: 08c

## Why

This applies 08a to the operator back office: `startLocalOwnerServer` (`apps/local-owner/src/local-owner-server.ts:1187`).

## What to build

- Add `createOwnerRequestHandler(options): { handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>; close(): Promise<void> }` in `local-owner-server.ts`, reusing the types from 08a.
- `startLocalOwnerServer` becomes a thin Node wrapper with the same options and handle.
- Any use of `req.socket` goes through the injected `clientAddress`.
- Keep the CSS `readFileSync` (:37) for now; 09a removes it.

## Out of scope

- Pilot dispatch (08c) and the assets (09a).

## Acceptance criteria

- AC1: The handler accepts only the narrow types; a compile-time test proves it.
- AC2: Operator login, a session-protected page, and the receipt read route, driven through `handle` with the `test/helpers/http-like.ts` fakes, behave the same as through the Node server. Failure path: a request without a valid session is redirected to login, and the receipt read without a session is refused (ADRs 0086, 0090).
- AC3: `close()` leaves no running timers.
- AC4: `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0086 | Token never in a URL; restart-safe sessions | unchanged; AC2 covers the session check |
| 0090 | Receipts are back-office only | AC2 failure path |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
