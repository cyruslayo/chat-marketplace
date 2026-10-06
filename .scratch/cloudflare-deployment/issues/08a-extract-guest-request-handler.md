# Narrow HTTP types; extract the guest request handler

Status: ready-for-agent
Type: task
Blocked by: 04a
Branch: `infra/cf-08a-guest-handler`
Requested: 2 Oct 2026
Unlocks: 08b, 09c

## Why

`startLocalGuestServer` (`apps/local-guest/src/guest-server.ts:6515`) creates its own `node:http` server. A Durable Object has no server to listen on: it receives a `Request` and must return a `Response`. So the request logic has to be callable as a plain `(req, res) => Promise<void>` function typed against a narrow interface. The shim (09c) can then implement that interface, and `tsc` will catch any member the shim forgot.

## What to build

- `packages/platform-core/src/http-like.ts` (or `apps/web/src/`, wherever shared HTTP types fit best; search first):
  - `HttpRequestLike`: `method`, `url`, `headers` (lower-cased, Node `IncomingHttpHeaders` shape), `on("data" | "end" | "error", …)` and `resume()`, plus anything else the handler **actually** uses. Find out with `tsc` errors after narrowing.
  - `HttpResponseLike`: `writeHead`, `setHeader`, `getHeader` if used, `end`, `headersSent`, `destroy`, `statusCode`.
  - Avoid `socket`. If the handler reads `req.socket.remoteAddress`, replace it with an injected `clientAddress(req)` function.
- In `guest-server.ts`, add `createGuestRequestHandler(options): { handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>; close(): Promise<void> }`. It returns the existing request logic, unchanged in behaviour.
  - `close()` stops the idle-eviction timer and closes the runtimes. `startLocalGuestServer` creates its timers today, so move them into the handler and make them stoppable.
- `startLocalGuestServer` becomes a thin wrapper: `createServer((req, res) => handler.handle(req, res))`, plus `listen` and `close`. Its options and its `LocalGuestServerHandle` are unchanged.
- Do not touch the module-level `readFileSync` calls yet; 09a does that.

## Out of scope

- The owner handler (08b), pilot dispatch (08c), the assets (09a) and the shim (09c).

## Acceptance criteria

- AC1: `createGuestRequestHandler(...).handle` accepts only `HttpRequestLike` and `HttpResponseLike`. A compile-time test proves that a minimal object implementing only those interfaces type-checks.
- AC2: A test drives `handle` with a hand-built fake request and response, with no `node:http` server, through a GET page, a form POST and a multipart receipt upload, and gets the same status, headers and body as through `startLocalGuestServer`.
- AC3: `close()` stops every timer the handler started. Failure path: a test with fake timers asserts that no timer fires after `close()`.
- AC4: The full `npm test`, including the Chromium guest journeys, passes unchanged, and `npm run check` is clean.

## Tests

Put the fake request and response builders in `test/helpers/http-like.ts`. Slices 08b, 09c and 10b will reuse them.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0080 | No-JS routes keep parity | AC2 covers the form and multipart paths |
| 0075 | No request logging added | handler unchanged |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
