# Spike Workers runtime compatibility

Status: claimed
Type: prototype
Blocked by: 01a, 01c
Branch: `infra/cf-01b-runtime-spike` (throwaway, **not merged**)
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

The local `cf dev` clock DOES advance during synchronous execution (3 ms on the successful run; 8 ms in the initial probe). This disproves the PRD assumption for this local runtime; it does not establish production clock behaviour. Slice 10b must not depend on a ticking synchronous clock: capture one server timestamp for an atomic decision and evaluate expiry at request/I/O boundaries. No production testing or runtime changes are made here.

## Answer
