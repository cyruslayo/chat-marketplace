# Fetch-to-node-HTTP shim

Status: resolved
Type: task
Blocked by: 01b, 03a, 08a
Branch: `infra/cf-09c-http-shim`
Requested: 2 Oct 2026
Unlocks: 10b

## Why

The PRD chose an adapter shim over a fetch-native rewrite. The Durable Object turns a Web `Request` into an `HttpRequestLike`, runs the handler, and turns the captured `HttpResponseLike` into a Web `Response`.

## What to build

`apps/cloudflare/src/http-shim.ts`:
- **`toHttpRequestLike(request: Request)`:**
  - `method` and `url` (path plus query only, as Node gives it), with lower-cased `headers` in Node's shape;
  - body chunks emitted as `Buffer` (or `Uint8Array`, per 01b) on `data`, then `end`, or `error` if the stream fails. **The exact raw bytes go through untouched**: no text decode or re-encode, which the Paystack webhook HMAC needs;
  - `resume()` drains and discards the rest;
  - every other member 08a's interface requires.
- **`createHttpResponseLike()`** returns a response-like object plus a `Promise<Response>`:
  - `writeHead` and `setHeader` collect headers. Several `Set-Cookie` values are each added with `Headers.append`, never joined;
  - `end(body)` resolves the Response;
  - `destroy()` resolves a 500 if nothing has been sent;
  - `headersSent` and `statusCode` track state.
- `clientAddressFromCloudflare(request)` reads `CF-Connecting-IP` and is used for the rate limiters in 08c. Fail closed to `"unknown"` if it is missing.
- Unit specs in `apps/cloudflare/test/http-shim.spec.ts`, using the fake handlers from `test/helpers/http-like.ts`.

## Out of scope

- Wiring into the Durable Object (10b).

## Acceptance criteria

- AC1: A webhook POST body arrives at the handler byte for byte, including non-UTF-8 bytes, and an HMAC computed in the handler matches one computed on the original bytes. Failure path: changing one byte makes the signature check fail.
- AC2: A `multipart/form-data` receipt upload (no-JS form, ADR 0080) parses in the guest handler through the shim, as it does on Node.
- AC3: Two `Set-Cookie` headers set by the handler arrive as two separate `Set-Cookie` headers on the Response.
- AC4: A handler that calls `destroy()` before sending yields a 500, and a handler that throws yields a 500. Neither leaves a Promise hanging.
- AC5: `npm run test:workers` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0087 / 0088 | Webhook verified on raw bytes | AC1 |
| 0080 | No-JS parity, including multipart | AC2 |
| 0086 | Session cookies intact | AC3 |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Answer

Implemented at `75ccc2d` on `infra/cf-09c-http-shim`, merged (fast-forward) into `infra/cloudflare-deployment`.

- **AC1** — `test("09c AC1: a webhook POST body arrives byte for byte, including non-UTF-8 bytes")`: a webhook-shaped handler receives the shim's pumped body bytes (with non-UTF-8 `0xff/0xfe` bytes), computes HMAC over exactly what it read, and matches the signature of the original bytes; the failure path changes one byte and the signature check fails. Proven in the workerd spec (`apps/cloudflare/test/http-shim.spec.ts`) and, with the real shim module on the Node program, in `test/http-shim-multipart.test.ts`.
- **AC2** — `test("09c AC2: a multipart receipt upload (no-JS form, ADR 0080) parses in the guest handler through the shim")` (`test/http-shim-multipart.test.ts`) drives the **real** `createGuestRequestHandler` through `toHttpRequestLike`/`createHttpResponseLike`: home (session cookie intact), manual-transfer start (303), a real `multipartBody` receipt upload (303, no session cookie), and the transfer page rendering from the parsed receipt (200) — the same journey and expectations as the Guest's 08a Node parity test.
- **AC3** — `test("09c AC3: two Set-Cookie headers set by the handler arrive as two separate Set-Cookie headers")`: a handler's `setHeader("Set-Cookie", [a, b])` yields `Response.headers.getSetCookie()` of exactly two values (append, never joined) — shape matching 08b's login/logout.
- **AC4** — `test("09c AC4: destroy() and a thrown handler each yield 500, and no Promise is left hanging")`: `destroy()` before send resolves a plain-text 500; the DO's catch-wiring calls the same `destroy()` for a handler that throws, so the promise always resolves.
- **AC5** — `npm run test:workers` (27 workerd tests, 5 files) and `npm run check` (all four programs) pass.
- `clientAddressFromCloudflare(request)` reads `CF-Connecting-IP` and **fails closed to `"unknown"`** when absent.

## Comments

- **Toolchain evidence recorded for 10b:** a probe in the workerd suite showed `node:sqlite` can be *imported* under workerd's `nodejs_compat` but `new DatabaseSync` throws "Illegal constructor". A fully injected Guest environment (`new LocalGuestEnvironment(config, { database: DurableObjectSqlDatabase, unitRepository, seedDemoUnits })`) constructs and serves the whole no-JS multipart flow inside a Durable Object — so 10b's composition can inject DO SQL + an inventory source without touching `node:sqlite` at runtime.
- **Location decision (scope note):** the shim implementation lives in `packages/platform-core/src/http-fetch-shim.ts` and `apps/cloudflare/src/http-shim.ts` re-exports it as the Durable Object's single import site. Reason: the root TypeScript program excludes `apps/cloudflare/**`, so a Node-side test program cannot import app sources — but the shim compiles cleanly under both type programs in `platform-core`. Behavior, path and API are exactly as the issue specifies.
- **Ambient note:** the guest/auth node sources do **not** type-check inside the `apps/cloudflare` programs (their ambient replaces Buffer/DOM shapes), so the `apps/cloudflare/test/http-shim.spec.ts` stays shim-only (no app imports) and the guest-driven coverage runs on the root test program — both still pinned to the same module. 10b must keep app code out of the `apps/cloudflare` tsconfig programs (compose it via imports into vetted surfaces and vet behavior through the workerd vitest runs, not a full-repo type program).
