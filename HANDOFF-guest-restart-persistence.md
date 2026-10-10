# Handoff — Guest booking journey restart persistence (Goal 1)

Starting commit (HEAD): `b27bd8be64b33f3a6b36b61b8734868726f21dc0`

Task brief lives in this repo. Read these before anything else:

- `docs/guest-journey-hardening.md` (working doc; already updated with Goal 1 design + ADR mapping)
- `AGENTS.md`, `CONTEXT-MAP.md`, `packages/platform-core/CONTEXT.md`, `domains/shortlet/CONTEXT.md`

## Where the work stands

The task is "Harden the Guest booking journey so active interaction state survives a real application process restart" (Goal 1 of a longer hardening sequence). It must prove server-backed restoration from a durable store using separate application instances, no new product features, no conversational-shell redesign, no booking-policy change. Original brief acceptance criteria AC1–AC16 plus a browser-restart proof.

### State of implementation

All durable-persistence plumbing is implemented and the dedicated restart suite passes:

- `test/guest-process-restart.test.ts` — 15/15 passing (`AC1..AC12` + discovery/inspection/review restore tests; AC7 rewritten to assert no *durable* consequential side-effect duplicates, because the in-memory audit log is intentionally per-process).
- `test/local-guest-shell.test.ts` + `test/local-guest-weaver-demo.test.ts` + `test/guest-booking-journey.test.ts` — 17/17 passing (one test was made hermetic with a per-test database path; no assertions weakened).
- `test/guest-browser-restart.test.ts` — 3/4 passing. The one failure is new and currently being debugged (see below).

`npm run check` (tsc --noEmit) is clean at this moment.

### Architecture introduced

A single durable SQLite file (`node:sqlite`) now backs the Guest composition via one shared `DatabaseSync` connection:

- `domains/shortlet/src/guest-interaction-store.ts` (new, exported via `domains/shortlet/src/index.ts`) — `SqliteGuestInteractionStore` with tables for:
  - `guest_session_bindings` (keyed by salted hash of session secret, never the raw cookie)
  - `guest_threads` (thread_id, principal_id, tenant_id, `thread_json` projection blob)
  - `guest_request_drafts`, `guest_booking_requests`, `guest_conditional_offers`, `guest_checkout_sessions`, `guest_live_payment_attempts`, `guest_processed_psp_references`
  - `guest_booking_snapshots`, `guest_payment_journey_snapshots`
- Durable implementations of existing repository interfaces:
  - `SqliteBookingStateRepository` (`booking-state.ts`)
  - `SqliteBookingPaymentJourneyRepository` (`booking-payment-journey.ts`)
  - `SqliteLivePaymentAttemptRegistry` + `LivePaymentAttemptRegistryPort` interface (`payment-attempt.ts`)
- Manager seams extended with an optional `store` option (in-memory default unchanged, so local-owner and other consumers are unaffected):
  - `BookingRequestManager` (`booking-request.ts`) — persists drafts/requests, hydrates lazily on `getDraft`/`getRequest`
  - `ConditionalOfferManager` (`conditional-offer.ts`) — persists offers; confirmation token is REDACTED on write and regenerated deterministically on hydrate
  - `CardPaymentManager` (`card-payment.ts`) — persists checkout sessions (PSP URL never stored, derived on hydrate), booking snapshots, processed PSP references; `#rehydrateFromStore()` in constructor
- `LocalGuestEnvironment` (`apps/local-guest/src/fixture.ts`) — opens the shared DB connection; wires `interactionStore`, durable journey/booking-state repos, `SqliteLivePaymentAttemptRegistry`, and a durable `LocalBookingContractRepository` (SQLite-backed now, still only records results the authoritative payment app returned).
- `apps/local-guest/src/guest-projection.ts` (new) — validated `GuestPersistentProjection` (versioned JSON contract for `guest_threads.thread_json`); never stores A2UI, model history, or draft free-text.
- `apps/local-guest/src/guest-server.ts` — `LocalGuestApp`:
  - `#loadThread(threadId)` restores a thread from the store (validates principal/tenant, parses projection, re-derives the current surface from authoritative domain state — **never issues a command during restoration**; expired/stale lifecycle preserved via artifact builders).
  - `#persistThread(thread)` after each remembered result.
  - `#restoreCurrentSurface(...)` dispatch for discovery / unit / draft / review / pending / outcome / offer / payment (ready / handoff / deposit / processing / expired) / confirmed.
  - `#refreshWorkflow` now adopts an existing durable offer (`findConditionalOfferByRequestId`) instead of issuing a second Conditional Booking Offer when a confirmed request already has one.
  - HTTP session handling is now durable-backed: `hashSessionSecret(cookie)` lookup in `guest_session_bindings`, principal/tenant validated against the environment, thread set derived from principal-scoped threads. No cookie → anonymous turn still allowed (legacy demo behavior) but no binding persisted; malformed or unknown well-formed cookie → 401 fail closed.
  - `bindBrowserThread` persists thread ownership under the resolved principal.
- `test/helpers/guest-restart.ts` — restart fixture: temp dir, shared SQLite path, server A → advance stage → `server.close()` → new `LocalGuestEnvironment` + `startLocalGuestServer` on the same path (no shared in-memory state, no reset method). `proveStage` helper drives discovery→…→confirmed.

### ADR compliance notes

ADR mapping table is in `docs/guest-journey-hardening.md` (rows 0004/0041/0044/0046/0070/0071/0072/0074/0075/0076/0077/0079/0080/0081/0082, and the ADR-read checklist). Key constraints honored: server-owned authoritative state; interaction store references aggregates by opaque id rather than copying full domain aggregates; no bearer/payment credentials, PSP URLs, confirmation tokens, raw identity evidence in durable state; restoration is re-derivation, not command replay; no Weaver state as authority (ADR-0081 host owns recovery).

## Known issue to finish

`test/guest-browser-restart.test.ts` — first test "Browser journey resumes on a new server instance over the same durable store" asserts `listConditionalOfferIds().length === 1` after `advance("offer")` + restart, but observes 2. Root cause chain (diagnosed but fix not yet verified end-to-end):

1. `advance("offer")` in the helper calls `simulateOperatorAcceptance(requestId)` (confirms request AND issues offer #1 at manager level), then sets `result` from `state()`.
2. `state()` → `getState` → `#refreshWorkflow`. The in-memory thread's `offerId` is still null (helper never set it), so previously refresh issued offer #2.
3. Fix applied to `#refreshWorkflow`: it now first checks `interactionStore.findConditionalOfferByRequestId(requestId)` and adopts the existing durable offer instead of issuing. The web demo test still passes with this change, but the browser-restart test observed 2 *before* the fix was verified after the last edit — re-run it. If still 2, check whether the projection persisted from env A already carried offerId (it should now) and whether the durable offer from `simulateOperatorAcceptance` (env A) is visible to env B's store (it should be: same SQLite file; `ConditionalOfferManager` persisted on issue).

## Validation still to run (in order)

1. `npx tsx --test test/guest-process-restart.test.ts` (expect 15/15)
2. `npx tsx --test test/guest-browser-restart.test.ts` (fix remaining failure; expect 4/4)
3. `npx tsx --test test/local-guest-shell.test.ts test/local-guest-weaver-demo.test.ts test/guest-booking-journey.test.ts` (expect 17/17)
4. `npm run check` (tsc --noEmit, zero errors)
5. `npm test` (full repository unit suite) — watch for regressions in tests that construct `BookingRequestManager`/`ConditionalOfferManager`/`CardPaymentManager`/`LocalGuestEnvironment` (all new options optional so should be unaffected) and any `any`-silencing lint
6. `npm run verify:weaver`
7. `git diff --check`
8. `git status --short` review; do NOT commit `.scratch/`, `apps/local-guest/dist/`, or the handoff file

## Files changed so far

Modified:
- `apps/local-guest/src/fixture.ts`, `apps/local-guest/src/guest-server.ts`
- `apps/web/src/booking-request-application.ts`, `apps/web/src/card-payment-application.ts`, `apps/web/src/conditional-offer-application.ts`
- `domains/shortlet/src/availability-store.ts` (pre-existing user change: shared-DB composition + `#ownsDatabase`)
- `domains/shortlet/src/booking-payment-journey.ts`, `booking-request.ts`, `booking-state.ts`, `card-payment.ts`, `conditional-offer.ts`, `index.ts`, `payment-attempt.ts`
- `test/local-guest-shell.test.ts` (hermetic DB path only)

New (untracked):
- `domains/shortlet/src/guest-interaction-store.ts`
- `apps/local-guest/src/guest-projection.ts`
- `test/guest-process-restart.test.ts`, `test/guest-browser-restart.test.ts`, `test/helpers/guest-restart.ts`
- `docs/guest-journey-hardening.md` (pre-existing untracked working doc, updated)

Pre-existing untracked user files that must be preserved untouched: `.scratch/`, `apps/local-guest/dist/`, `docs/design/`, `docs/mobile-agent-experience-recommendation.md`, `docs/research/`.

## Completion report items the next agent must produce

The original brief requires a 32-item completion report (starting SHA `b27bd8b…`, final SHA after commit, ADR mapping, persistence mechanism, files changed, durable state stored vs not stored, per-stage restart proofs, duplicate-command/inventory-hold/stale/expired/session/tenant isolation proofs, security review, dependency changes [none expected], each validation result, unresolved gaps, deferred work, final `git status --short`). Do not claim restart persistence unless separate application instances over the same durable store are proven — that is exactly what the restart tests establish.

## Suggested skills

- `/code-review` or `/review` — before committing, review the diff for domain-layer `any`, fail-open negative validation, or duplicated fixtures
- `/diagnose` or `/diagnosing-bugs` — for the remaining browser-restart test failure if re-running after the `#refreshWorkflow` fix still shows 2 offers
- `/tdd` — if adding any new acceptance test for the adopted-offer path
- `/issue-tracker` — if this work is tracked as an issue under `.scratch/shortlet-concierge-launch/issues/`, follow Definition of Done before marking resolved
- `/domain` — re-verify no invented policy strings or vocabulary drift in the new store/projection code
