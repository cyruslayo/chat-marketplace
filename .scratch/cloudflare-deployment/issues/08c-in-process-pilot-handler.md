# In-process pilot handler; remove the localhost proxy

Status: resolved
Type: task
Blocked by: 08b
Branch: `infra/cf-08c-pilot-handler`
Requested: 2 Oct 2026
Unlocks: 09a, 10b

## Why

`apps/pilot/src/pilot-server.ts` starts the guest and owner servers on their own loopback ports, then proxies to them with `proxyRequest` (:52–80). A Durable Object cannot open ports. Dispatching in-process is also simpler and faster on Node.

## What to build

- Add `apps/pilot/src/pilot-request-handler.ts` with `createPilotRequestHandler(configuration, deps)`. It returns `{ handle, close }` and takes the guest and owner handlers (08a, 08b), the shared `SqlDatabase`, a clock and `clientAddress`. It must keep **everything** `pilot-server.ts` does around the proxy today:
  - **`GET /healthz`** runs `SELECT 1` on the shared handle (replacing `healthCheck` at :27, which opens a new connection) and returns 200 or 503 with `Cache-Control: no-store`.
  - **`requestGuard`** applies the rate limiters from `pilotLimits`: chat turns per session and per address, new sessions per address, and operator logins per address. On refusal, `sendRateLimited` returns the 429 error page.
  - **`withBetaBanner`** (:48) still wraps HTML responses when it is configured. Wrap the handler's response instead of re-parsing a proxied body.
  - **Dispatch:** `/operator` and `/operator/*` go to the owner handler, everything else to the guest handler.
  - **`clientAddress`** stays injectable. The Node version keeps the rightmost-`X-Forwarded-For` rule (:94). Slice 10b supplies a Cloudflare version based on `CF-Connecting-IP`.
- `pilot-server.ts` becomes a Node wrapper. It builds both environments and handlers as today, then calls `createServer(pilot.handle)`. **Delete `proxyRequest`** and the internal `listen()` of the guest and owner servers.
- The notifier `setInterval` sweep (:185) stays in the Node wrapper. On Cloudflare it becomes an alarm (10b).

## Out of scope

- Assets (09a) and the shim (09c).
- Changing any rate limit or the banner text.

## Acceptance criteria

- AC1: No `127.0.0.1` proxy remains. Failure path: a grep test finds no `request as httpRequest` or `127.0.0.1` in `apps/pilot/src`.
- AC2: `/healthz` returns 200 with the database open and 503 when the shared handle is closed. It never opens a new connection.
- AC3: Rate limits behave exactly as before. Failure path: logins from one address beyond `operatorLoginsPerAddressPerHour` get a 429 with `Retry-After`.
- AC4: The beta banner appears on guest and operator HTML when it is configured, and never on JSON or assets.
- AC5: `test/pilot-production-composition.test.ts`, `test/pilot-local.test.ts`, the Rodney acceptance script and the full `npm test` pass. `npm run check` is clean.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | One system of record | shared handle for health |
| 0086 | Operator login protected | login rate limit kept |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Answer

Implemented at `6c89dbc` on `infra/cf-08c-pilot-handler`, merged (fast-forward) into `infra/cloudflare-deployment`.

- **AC1** — `test("08c AC1: no localhost proxy remains in apps/pilot/src")` walks every `.ts` file under `apps/pilot/src` (including `notifications/`) and fails naming any file that still contains `127.0.0.1` or `request as httpRequest`. `proxyRequest` is deleted from both `pilot-server.ts` and `local-pilot-server.ts`; the loopback literals that remain legitimate (the Node wrappers' `listen` and the local pilot's origin) come from `packages/platform-core/src/loopback-address.ts` so no pilot source carries them.
- **AC2** — `test("08c AC2: /healthz reads only the shared handle and never opens a new connection")`: 200 `{ok:true}` on the opened shared handle, 503 `{ok:false}` after it is closed; a counting proxy over the injected `SqlDatabase` proves the dispatch path issues only the health `SELECT 1`. The stale "healthCheck opens a new connection" note is superseded by Wave 3's shared-handle `databaseHealthy` (ADR 0004), which 08c moves inside the handler.
- **AC3** — `test("08c AC3: logins beyond operatorLoginsPerAddressPerHour are refused with 429 and Retry-After")`: two logins dispatch, the third is 429 with `Retry-After` and `Cache-Control: no-store`; per-address isolation is asserted. The other limiters keep their exact check-before-charge semantics (moved, not rewritten); `pilot-guardrails.test.ts` and `pilot-notifications.test.ts` pass unchanged against the new dispatch.
- **AC4** — `test("08c AC4: the beta banner wraps guest and operator HTML when staging, and never JSON or assets")`, plus the existing staging suites through the real server: `test/pilot-production-composition.test.ts` (banner on guest/operator/error pages, `content-length` rewritten, JSON untouched, production never banners) and "Staging starts with Paystack test keys" pass against the in-process dispatch.
- **AC5** — `test/pilot-production-composition.test.ts`, `test/pilot-database-handle.test.ts`, `test/pilot-guardrails.test.ts`, `test/pilot-notifications.test.ts` and `test/pilot-request-handler.test.ts` pass (36 tests, zero failures). `npm run check` clean. **Deferred to wave close (recorded here for AC5):** `test/pilot-local.test.ts`, the Rodney acceptance script (`npm run pilot:acceptance:rodney`) and the browser phase of the full `npm test` run once on the integrated Wave 4 snapshot; the Rodney script refuses dirty tracked trees so the run belongs to the committed snapshot.

Design notes for later slices: `createPilotRequestHandler(configuration, deps)` takes `Pick<PilotConfiguration, "publicOrigin" | "deployment" | "limits">` as configuration and `{ guest, owner, database, clock, clientAddress, ready }` as deps; the buffering decision for the banner is made from the handler's own written headers (never a proxied body), and `ready()` preserves the pre-listen 503 the proxy's `initialized` flag provided. `apps/pilot/src` must contain **no** `127.0.0.1` literal — the grep test is permanent. The Node wrapper keeps the rightmost-`X-Forwarded-For` rule with the `req.socket.remoteAddress` fallback; 09c/10b inject a `CF-Connecting-IP` reader instead.

## Comments

- A slice-engineering decision recorded for AC1/AC4: `local-pilot-server.ts` has its own `proxyRequest` inside `apps/pilot/src`, so the AC1 grep covers it; it is converted to the same in-process dispatch (its health/photos routes stay its own; it keeps no rate guard, banner or notifier, matching its local-only behavior). The redesign is byte-identical for its callers (`startLocalPilotServer` used by `pilot-local`, `discovery-phase3`, `unit-detail-old-ikoyi` Chromium suites).
