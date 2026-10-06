# In-process pilot handler; remove the localhost proxy

Status: ready-for-agent
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

## Comments
