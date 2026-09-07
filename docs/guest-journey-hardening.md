# Guest journey hardening

Starting commit: `b27bd8be64b33f3a6b36b61b8734868726f21dc0`.

The four goals run sequentially: durable restart restoration, real cross-tab
concurrency, redacted transition telemetry, then interactive mobile validation.
No later goal is considered passed before the preceding goal passes its gates.

## Goal 1 implementation plan and ADR mapping

| ADR | Constraint | Acceptance criteria / affected path |
| --- | --- | --- |
| 0004 | Backend owns conversation and transactions | AC1–AC16; SQLite repositories and authenticated restoration |
| 0005, 0006 | Request to Book; contract only after acceptance and verified payment | AC2–AC7; request, offer, payment, Reservation recovery |
| 0012–0013, 0065, 0085 | Check-In-only identity assurance; Self-Booking and payer controls; no raw evidence | Booking identity independence, access-release boundary, and persistence allow-lists |
| 0014–0016, 0058, 0059 | Preserve versioned terms, all-in totals, separate deposit and conduct rules | AC1–AC7; persisted domain snapshots and regenerated artifacts |
| 0039, 0040 | Central authoritative inventory; expiry does not reset | AC7–AC9; existing SQLite availability store; zero hold duplication |
| 0041–0043 | Draft does not reserve; delivery and response clocks remain distinct | AC1–AC3, AC8, AC9; request recovery |
| 0044–0046 | Original payment deadlines; one live attempt; no late resurrection | AC4–AC7, AC8; payment recovery and idempotency |
| 0047–0050 | Capability-gated rails; hosted card credentials excluded | AC5, AC6, AC14; payment storage boundary |
| 0051–0057 | No risk, cutoff, horizon, inspection or authority shortcuts | AC8–AC11; fresh authoritative validation |
| 0066, 0067 | Preserve discovery disclosure and channel boundaries | Discovery / Unit restoration and AC14, AC15 |
| 0068, 0069 | Versioned, validated adapter boundaries, as amended by 0081 | Restoration presentation and existing replay contracts |
| 0070 | Principal, tenant, session, thread, run and aggregate identities stay separate | AC8, AC12, AC13; hashed session binding and thread identity |
| 0071 | Redacted projection, separate draft input and ephemeral UI | AC1–AC16; allow-listed durable interaction projection |
| 0072 | Commands retain authorization, confirmation, concurrency and idempotency | AC4–AC13; restore is not command replay |
| 0073 | Approved catalogue; no persisted executable/generated authority | AC8, AC10, AC16; regenerate surfaces from artifacts |
| 0074 | Durable surface identity/revision; stale and expired actions fail closed | AC10, AC11; lifecycle recovery and current-domain checks |
| 0075 | Session-bound authorization; credentials/evidence excluded | AC12–AC15, Token tests 1–5; hashed session proof, unpredictable token salt |
| 0076 | Restart does not restart suspended automation | Recovery excludes model execution and runtime history |
| 0077 | Canonical artifacts preserve facts and consent | AC1–AC9, AC16; regenerate current presentation |
| 0078 | Accessible fallback, 320px support, WAT and NGN | Existing Guest browser suite; Goal 4 |
| 0079 | Durable replay/correlation; zero duplicate side effects | AC8, AC9, AC16; separate-instance tests and command-count evidence |
| 0080 | Same domain command path for deterministic and rich UI | AC1–AC7; reuse existing applications |
| 0081 | Weaver is replaceable; host owns restart recovery | All criteria; no Weaver state as authority |
| 0082 | Operator actions require a current explicit representative grant | AC3, AC4, AC8; existing SQLite grant store |

Use repository-supported SQLite (`node:sqlite`) and existing repository seams.
Store authoritative domain records separately from interaction references and
surface lifecycle metadata. Do not serialize the frontend, model history, bearer
session cookies, confirmation tokens, PSP checkout URLs, or identity evidence.
Regenerate presentation from current authoritative records after authorization.

Guest Identity Verification is deferred from booking eligibility to
Check-In Eligibility by ADR-0085. The booking success path intentionally uses
an unverified Guest. The future boundary is Reservation → Check-In Eligibility
→ Human-Assisted Identity Verification → Access Authorization; its operational
workflow is not implemented here.

Tests must close the first HTTP server and environment, construct a new environment
and server against the same temporary database, authenticate the same browser
session again, and resume the same thread. No reset on the first application and
no shared application objects qualify as restart evidence.

## Baseline findings

- Guest threads, browser session bindings, requests, offers, payment sessions and
  payment idempotency records currently live in process memory.
- Availability already supports a durable SQLite store, but the Guest composition
  currently uses its in-memory default.
- Operator representative grants already use the configured SQLite file.
- The current refresh path can invoke offer issuance. Restoration must recover
  an existing offer without issuing another consequential command.
- Existing untracked user files were present before work and must be preserved.

## Goal 1 persistence design (restart restoration)

The Guest composition (apps/local-guest) keeps thread runtime, workflow pointers,
active surfaces and the booking-request/offer/payment managers in process memory,
while availability commitments already live in the durable SQLite availability
store. To prove restart restoration without adding infrastructure, the Guest
composition moves its authoritative interaction projection onto a dedicated
durable SQLite store (node:sqlite) next to the existing availability and grant
files, and its authoritative domain records move from in-memory manager Maps
onto durable SQLite repositories behind the existing manager seams.

State kept server-owned and durable (not browser): principal/tenant/session
binding, thread identity and timeline projection, current workflow aggregate
correlation (unit, draft, request, offer, contract), the authoritative Booking
Request, the Conditional Booking Offer, the checkout session, the Live Payment
Attempt, processed PSP references, and current surface lifecycle metadata.
Authoritative availability commitments, operator representative grants and
confirmed Booking Contracts stay in their own stores; the interaction store
references them by opaque id and never copies the full domain aggregate.

State intentionally not stored: model history, Weaver/agent run state,
browser-local UI state, Guest draft free-text input, bearer session cookies
(only a salted hash), PSP checkout URLs, confirmation tokens, card/payment
credentials, raw identity evidence and protected access information.

Restoration is server-side re-derivation, not browser replay. After restart the
server authenticates the principal, restores the thread projection from the
store, regenerates the current authoritative projection from the durable domain
repositories, lazily re-evaluates deadlines/expiry against the current clock and
fails closed when the store or any current-domain validation does not line up.
No consequential command is issued during restoration; a restart never resubmits
a Booking Request, reissues an offer, reinitializes a checkout or re-verifies a
payment.

Tests close server/environment A and construct a new server/environment B over
the same database files; no in-memory state is shared and no reset method is
used. See test/guest-process-restart.test.ts.

## Validation status

Goal 1 (durable restart restoration) complete and verified:
- `test/guest-process-restart.test.ts` (23/23 passing; AC1–AC16, Token tests 1–5, and restoration stages)
- `test/guest-browser-restart.test.ts` (4/4 passing; browser restart flow over shared durable store)
- `test/local-guest-shell.test.ts`, `test/local-guest-weaver-demo.test.ts`, `test/guest-booking-journey.test.ts` (17/17 passing)
- `npm run check` (clean; zero type errors)
- `npm test` (full suite passes, 621/621 tests across 6 suites)
- `npm run verify:weaver` (clean)
- `git diff --check` (clean)
