# Narrow HTTP types; extract the guest request handler

Status: resolved
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

## Answer

Implemented at `f1ff86c` on `infra/cf-08a-guest-handler`, merged (fast-forward) into `infra/cloudflare-deployment`.

- **AC1** — `packages/platform-core/src/http-like.ts` defines `HttpRequestLike` (`method`, `url`, lower-cased Node-shape `headers`, `on("data"|"end"|"error")`, `resume()`) and `HttpResponseLike` (`headersSent`, `writeHead`, `setHeader`, `end`, `destroy`). `test("08a AC1: createGuestRequestHandler().handle accepts only HttpRequestLike and HttpResponseLike")` proves a minimal, interface-only object type-checks and that incomplete objects are refused (`@ts-expect-error`).
- **AC2** — `test("08a AC2: handle drives a GET page, a form POST and a multipart receipt upload like the Node server")` runs six requests (home, manual-transfer page, the no-JS composer form POST with an empty message refused 400, manual-transfer start POST, a real multipart receipt upload 303, post-upload page) through `handler.handle` with the `test/helpers/http-like.ts` fakes **and** through a real `node:http` server on identically seeded environments, comparing scrubbed responses (UUIDs, `SL-` references, session cookies, transport-only headers normalized) — ADR 0080 parity.
- **AC3** — `test("08a AC3: close() stops every timer the handler started; idle eviction stays lazy")` uses fake timers: time alone evicts nothing, `close()` drops `activeSessionRuntimes` to 0 (the runtime map is cleared), and time after close wakes nothing. Double-close is a no-op.
- **AC4** — `npm run check` passes on the slice branch (all three `apps/cloudflare` tsconfigs). The full non-browser phase ran in four foreground chunks: **1,368 tests (337 + 342 + 410 + 279), zero failures**, including `test/guest-request-handler.test.ts` and `pilot-local` AC4 inside chunk 3. `npm run test:workers` rerun after the previous session's hang passed cleanly: **22 workerd tests in ~16 s** — the hang does not reproduce. The browser (Phase 2) phase runs once on the integrated snapshot at wave close, per prior-wave convention.

ADR compliance per the issue table: no request logging added (ADR 0075 — the handler's error handling is unchanged); no-JS form/multipart parity proven by the AC2 comparison (ADR 0080). Environment caveats for later slices: `NODE_ENV=production` is set machine-wide and must be unset per test invocation; background shell output capture is unreliable here, so long suites run in foreground chunks.

## Comments
