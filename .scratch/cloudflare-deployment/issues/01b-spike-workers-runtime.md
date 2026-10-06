# Spike Workers runtime compatibility

Status: resolved
Type: prototype
Blocked by: 01a, 01c
Branch: `infra/cf-01b-runtime` (throwaway, **not merged**)
Requested: 2 Oct 2026
Unlocks: 09c, 10b

## Why

The Durable Object will run the existing guest and owner code under `nodejs_compat`. Several dependencies and behaviours are unverified in workerd. Find out now, before the shim (09c) and the scaffold (10b) are built.

## What to build

Extend the 01a spike Worker (`spikes/`) and answer each question with a snippet and its observed output:

- `@google/genai`: does it bundle, and can it make one `generateContent` call under `nodejs_compat`? A mocked `fetch` is acceptable if no key is at hand. Record any bundling errors.
- `node:crypto` `createHmac("sha512", …)` and `timingSafeEqual`, as used by the Paystack webhook signature check in `domains/shortlet/src/paystack.ts`. Do they give the same digest as Node for the same raw bytes?
- `node:net` `isIP`: is it available?
- `new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })`: compare its output with Node's for 3 fixed instants (ADR 0078).
- `Buffer`: is it available globally, or only as an import from `node:buffer`?
- Stream a 5 MB `multipart/form-data` body from the Worker to the Durable Object via `stub.fetch(request)`. Is the body streamed or buffered, and do any limits apply?
- `Date.now()` inside a synchronous loop: confirm it does not advance (PRD "Implementation watch-outs").

## Out of scope

- SQL questions (01a).
- Any change under `apps/`, `domains/` or `packages/`.

## Acceptance criteria

- AC1: Every question has an answer in `## Answer`, with the snippet and its observed output.
- AC2: Any incompatibility found has a named workaround, and the slice that must apply it (09c, 10b or 10a).
- AC3: The `Intl` comparison is recorded as identical, or the differences are listed and a follow-up is raised for ADR 0078 display code.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| 0078 | en-NG and Africa/Lagos display must match Node. |
| 0087 | The webhook HMAC must verify the exact raw bytes. |

## Definition of Done

Prototype slice. Answers recorded; no repo code changed.

## Comments

| ADR | Constraint | Spike path |
| --- | --- | --- |
| 0078 | en-NG / Africa-Lagos output parity | Three fixed instants compared to Node |
| 0087 | HMAC verifies exact raw bytes | Identical binary input / synthetic key |
| 0075 / 0095 | No real credentials/data or deployment | Mocked Gemini; local cf dev / dry-run only |

The local `cf dev` clock DOES advance during synchronous execution (3 ms on the successful run; 8 ms in the initial probe). Production clock behaviour remains untested; slice 10b must not rely on sync-loop clock advancement.

## Answer

Implementation/evidence: `711b863`, throwaway branch `infra/cf-01b-runtime`, `spikes/runtime/src/index.ts`, runnable assertions in `check.mjs`, observed outputs in `README.md`. Only this answer is integrated. `npm exec cf -- build`, `npm exec cf -- dev`, `node check.mjs` and `npm exec cf -- deploy --dry-run` passed using the 01c pins, with Node 22.19.0. No remote upload or real API request occurred.

| Question / snippet | Observed local output |
| --- | --- |
| `new GoogleGenAI({ apiKey: synthetic }).models.generateContent(...)`, replacing fetch temporarily with a synthetic JSON response | Bundled successfully; one mocked fetch; text `mocked-gemini-ok` |
| `createHmac('sha512', 'synthetic-spike-key').update(new Uint8Array([0,255,123,34,195,169,34,125])).digest()` | `e66a8dc291268caf346169258942c2f5eea96e3cf40b5451cc7bd0949c35131df41287e2791bfbf38ad9e0855f16fd04af2a75a076971cc35b8848fa77aba332`, identical to Node; timingSafeEqual true for equal bytes, false for same-length unequal bytes |
| `isIP('127.0.0.1'), isIP('::1'), isIP('not-an-ip')` | `[4,6,0]` |
| `Intl.DateTimeFormat('en-NG', {timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'})` at `2026-01-01T00:00Z`, `2026-07-22T23:30Z`, `2026-12-31T23:00Z` | `1 Jan 2026, 01:00`; `23 Jul 2026, 00:30`; `1 Jan 2027, 00:00` — identical to Node; no display follow-up required |
| `typeof globalThis.Buffer`; imported `Buffer.from([0,255]).toString('hex')` | `function`; `00ff` — both global and explicit import work |
| `env.PROBE.get(...).fetch(request)`, DO body reader, producer pauses 300 ms after first payload chunk | 5 MiB payload plus 176 multipart bytes = 5,243,056 bytes; 1,522 chunks; largest 4,096 bytes; first-to-last read 406 ms. Progressive local consumption demonstrated; no whole-body materialization in the forwarding code. Hosted limit untested |
| `before=Date.now(); for(i=0;i<2_000_000;i++)sum+=i; after=Date.now()` | Sum 1,999,999,000,000; local delta 3 ms (first run 8 ms), NOT frozen |

AC1–AC3 and prototype DoD reviewed: every question has runnable code plus observed output; crypto and Intl have Node comparisons; synthetic-only credentials and body; no domain/application changes. Workarounds: 10b must capture one clock value per atomic decision and never rely on sync-loop time advancing (production untested); 09c should preserve the body stream and keep its configured upload-limit guard, not infer a hosted quota from this local upload. No other incompatibility was found. Production config, shim, secrets and staging remain out of scope.
