# Extract the owner request handler

Status: resolved
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

## Answer

Implemented at `bb247a3` on `infra/cf-08b-owner-handler`, merged (fast-forward) into `infra/cloudflare-deployment`.

- **AC1** — `createOwnerRequestHandler` in `apps/local-owner/src/local-owner-server.ts` types `handle` only against 08a's `HttpRequestLike`/`HttpResponseLike`; `test("08b AC1: createOwnerRequestHandler().handle accepts only HttpRequestLike and HttpResponseLike")` proves a minimal interface-only object type-checks (and refuses incomplete objects via `@ts-expect-error`).
- **AC2** — `test("08b AC2: operator login, a session-protected page and the receipt read behave like the Node server")` drives login (302 with the two `Set-Cookie` headers kept separate), the session-protected `/operator` home, and `GET /operator/transfers/:id/receipt` through the fakes **and** through the real `node:http` server on identically seeded environments, comparing scrubbed responses. Failure paths per ADRs 0086/0090: a request with no session is redirected 303 to `/operator/login` (pages) and the receipt read without a session is refused (303) — both compared across transports.
- **AC3** — `test("08b AC3: close() leaves no running timers and the environment closed")`: fake timers over the handler's lifetime; an hour ticks by with nothing waking; `close()` resolves and is idempotent; the environment reads fail closed afterwards. The owner handler schedules no timers, so none survive close.
- **AC4** — `npm run check` clean (all tsconfigs). Full non-browser phase in four foreground chunks: **337 + 342 + 409 + 283 = 1,371 tests, zero failures** (includes `test/owner-request-handler.test.ts`). `npm run test:workers`: 22 tests pass. Browser phase deferred to wave close.

Extraction notes: the unexpected-error 500 catch moved from the `createServer` wrapper into `handle` itself (a handler-driven callable must keep the "one bad request never stops the back office" guarantee without a server); the owner `readForm` and the developer-dashboard action body read were converted from async iteration to `on("data")` buffering within the same 4 KiB ceiling, so `HttpRequestLike` needs no `[Symbol.asyncIterator]` for the shim. `HttpResponseLike.setHeader` now accepts a value list (ADR 0086's login/logout cookie pairs stay two separate header lines) and `test/helpers/http-like.ts` records one entry per list item.

## Comments

- Slice claim recorded 7 Oct 2026; tests written criterion-first (red before the export existed).
