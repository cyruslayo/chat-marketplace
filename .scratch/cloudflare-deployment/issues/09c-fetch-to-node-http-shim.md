# Fetch-to-node-HTTP shim

Status: ready-for-agent
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

## Comments
