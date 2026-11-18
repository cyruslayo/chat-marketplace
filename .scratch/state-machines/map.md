# Map: implicit state machines

PRD: `PRD.md`. Line numbers come from a sweep of an earlier checkout and are approximate on `main`, so find code by symbol name.

## Issues

| # | Track | Issue | Status | Blocked by |
|---|---|---|---|---|
| 01 | A | State-machine map for agents (`docs/agents/state-machines.md`) | resolved | - |
| 02 | A | Ratchet test keeps the map current | resolved | 01 |
| 03 | B | `canTransition` predicate in platform-core | resolved | - |
| 04 | B | BookingRequest: typed records (no `any`), exported status union, one delivered/deadline predicate | resolved | 03 |
| 05 | B | ConditionalOffer and Reservation unions and tables | resolved | 03 |
| 06 | B | Card session, bank transfer session, manual transfer, live attempt tables | resolved | 03 |
| 07 | B | BookingPaymentJourney stage table and one `#setStage` | resolved | 03 |
| 08 | B | One `SurfaceLifecycleStatus` (re-export from platform-core) | resolved | 01 |
| 09 | B | Exhaustive `satisfies Record` copy maps in web-agent presentation | resolved | 01 |
| 10 | B | `deriveGuestStage` projection that keeps today's per-site results, plus a matrix | ready-for-agent | 01 |
| 11 | C | Deposit payment in processing restores as processing | resolved | - |
| 12 | C | Unknown payment status no longer says "Booking confirmed" | to write | 09 |
| 13 | C | Stale or revoked offer does not restore as active | resolved | - |
| 14 | C | Expired confirmation is cleared, so the guest is not stuck | resolved | - |
| 15 | C | Unknown card-session status fails closed | resolved | - |
| 16 | C | Stale `draftId` cleared on a new search | to write | 10 |
| 17 | C | Allow-list hardening: `resolveExpiry`, `commitAmendment`, surface from-state | to write | 05, 06, 07, 08 |
| 18 | C | One guest stage everywhere: collapse each matrix disagreement | to write | 10, 11, 13, 16 |
| 19 | C | Draft-replacement card restored after a cold restore | to write | 10 |
| 20 | D | Pending-action card re-rendered after a cold restore? | to write | - |
| 21 | D | Turn recovery: redacted server text vs raw client text | to write | - |
| 22 | D | Client in-flight flags (`isLoading` vs `eventInFlight`), `THREAD_BUSY` | to write | - |
| 23 | D | Offer page reload loop at the deadline | to write | - |
| 24 | D | Deposit-claim day 14/45/90 steps have no from-state check | to write | - |
| 25 | D | Owner decision: keep or remove each never-written state (offer `revoked`; card session `failed`/`expired`; journey `failed`/`expired`; check-in `active`/`human_owned`/`closed`; overstay `resolved`) | needs-info | - |
| 26 | D | Draft replacement can pass an undefined self-booking attestation into `createDraft` (made visible by issue 04 cast in `shortlet-app.ts`); confirm whether reachable | to write | - |

## Seed inventory (for issue 01)

### Domain (`domains/shortlet/src`, `packages/platform-core/src`)

| Machine | States | Writes and guard | Gaps |
|---|---|---|---|
| BookingRequest (`booking-request.ts`) | draft, disclosed, delivery_failed, expired, confirmed, declined | Inline writes; `Map<string, any>`; lazy `projectBookingRequestStatus` | Untyped; the delivered/deadline rule appears 3 times; decline after the deadline (owner question 1) |
| ConditionalOffer (`conditional-offer.ts`) | issued, accepted, expired, stale, revoked | Accept checks a list; stale/expired are set on accept and not persisted | `revoked` never written; restore re-issues a token for `issued` only |
| Reservation (`card-payment.ts`) | confirmed, cancelled, no_show | `transitionReservationStatus` (expected `confirmed`) | `cancellation-noshow.ts` uses a parallel `no_show_confirmed` |
| BookingContract (`booking-state.ts`) | version only | `mutateContract` version CAS | `securityDeposit.status` frozen at `held` but read as live |
| BookingPaymentJourney (`booking-payment-journey.ts`) | 13 stages | About 15 writes in `card-payment.ts` and `bank-transfer.ts`; `journeyVersion` CAS only | No from-stage check; `failed`/`expired` never written |
| Card checkout session (`card-payment.ts`) | initiated, completed, expired, failed | New checkout blocked while `initiated` | Unknown row status loads as `initiated` (issue 15) |
| Bank transfer session (`bank-transfer.ts`) | initiated, processing_in_grace, completed, expired, refunded | Inline | `resolveExpiry` deny-list admits completed→expired (latent; issue 17) |
| Manual transfer (`manual-transfer.ts`) | awaiting_receipt, awaiting_verification, confirmed, rejected, expired | `#decidable` plus lazy `#expireIfDue` | Blind upsert |
| Live payment attempt (`payment-attempt.ts`) | active, terminal | acquire/release; lazy expiry | `release` not tied to an attempt id |
| Period payment (`period-payment.ts`) | billing period projection; session superseded/expired/completed | Idempotent verify | Expiry uses `>` where card and bank transfer use `>=` |
| Booking amendment (`booking-amendment.ts`) | proposed, accepted, awaiting_financial_settlement, committed, rejected, expired | Deny-list commit guard | `status` and `lifecycleStatus` duplicated; settlement runs before the CAS |
| Deposit claim (`deposit-claim.ts`) | case status, ledgerStatus, exceptionalStatus, finality | Production path in `apps/web/src/deposit-claim-application.ts` | Day 14/45/90 steps have no from-state check (issue 24); legacy manager is test-only |
| Security deposit accounting (`security-deposit-accounting.ts`) | collection, binding, refund, award | Allow-from lists (precedent) | `markAwardStatus` accepts any target |
| HumanRiskReview (`human-risk-review.ts`) | pending_review, approved, rejected, expired_unresolved, cancelled | Deadline guard | In-memory only |
| Availability commitment (`availability-store.ts`) | active and others | SQL CAS (clean precedent) | - |
| Reserve tranche (`reserve-payout-trust.ts`) | held and others | Guard plus transaction (clean) | - |
| Owner payable (`owner-payable.ts`) | not_yet_due, due, paused, paid, nothing_owed, overpaid | Pure projection (precedent) | - |
| Check-in support / overstay / mid-stay (`checkin-support.ts`, `checkout-overstay.ts`, `mid-stay-failure.ts`) | various | Unguarded writes | Never-written states (issue 01 AC2) |
| Surface lifecycle (`packages/platform-core/src/surface.ts`) | active, superseded, stale, expired, deleted, fallback | No from-state guard | deleted→stale possible (issue 17); union duplicated in `conversational-shell.ts` (issue 08) |
| Thread runs (`packages/platform-core/src/thread.ts`) | run statuses | Overwrites terminal runs | - |
| Human handoff (`packages/platform-core/src/human-handoff.ts`) | automated, handoff-requested, human-owned, resume-pending | `#transition` (precedent) | - |

### Guest shell and concierge (`apps/local-guest/src`, `apps/web-agent/src`)

| Machine | Where | Gaps |
|---|---|---|
| Guest stage (never stored as one value) | `shortlet-app.ts` `#guestStage`, `#journeyFor`, `#stageForSurfaceId`, `#inferActiveStage`, `#restoreCurrentSurface`, `#safeAssistantTimelineMessage`; `assistant/shortlet-assistant-pack.ts` `dateShowBackFor`, `shortletTaskSummary`, `sentStageFor`; `journey-rail.ts` | 9 derivations that disagree (issues 10, 18); `draftId` never cleared (issue 16) |
| Surface lifecycle (shell and runtime copies) | `shortlet-app.ts` `activeSurfaces`/`supersededSurfaces`; `assistant/assistant-state.ts`; `assistant-turn-transaction.ts`; `conversational-shell.ts` | Offer restore status (issue 13); draft-replacement restore branch (issue 19); `:pending-action:` maps to no stage (issue 20) |
| Shell and runtime mirror | `#syncAssistantPersistence`, `#restoreAssistantFromGuestThread`, `restoreShortletState` | Ids only move forward; artifact id re-minted in sync, kept in restore |
| Pending action | `assistant/pending-actions.ts`, `assistant-runtime.ts` `#executePendingAction` | Expired action never cleared (issue 14) |
| Draft replacement | `draft-replacement.ts` | `draftChangeContext` lost on restore |
| Turn lock, transaction, recovery | `assistant-thread-lock.ts`, `assistant-turn-transaction.ts`, `guest-turn-recovery.ts` | Redacted vs raw match (issue 21); no client `THREAD_BUSY` handling (issue 22) |
| Agent mark | `agent-mark-state.ts` | Explicit already (precedent) |
| Payment restore ladder | `shortlet-app.ts` payment branch | Deposit processing (issue 11); checkout id `"restored"` |
| Payment and offer copy | `web-agent/booking-presentation.ts` `guestPaymentStatus`, `payment-presentation.ts`, `offer-presentation.ts` | Fall-through to "Booking confirmed" (issues 09, 12) |
| Offer page | `offer-page.ts` | Reload loop at the deadline (issue 23) |
| Budgets, quota, response mode, identity status | `model-call-budget.ts`, `model-quota-guard.ts`, `response-mode.ts`, `guest-identity-status.ts` | In-memory budget resets on eviction |

### Worker and ops

| Machine | Where |
|---|---|
| Cutover (one way) | `apps/cloudflare/src/cutover-marker.ts`, `ops-routes.ts`, `ops-import-core.ts` (fail closed) |
| Daily export | KV `export:lastDate` vs `platform:export:lastDate` (two key names) |
| Alarm, provisioning, model quota, account status, guest code, ops auth, restore | `shortlet-pilot-do.ts`, `platform-do.ts`, `model-request-quota.ts`, `authority.ts`, `ops-auth.ts` |
| Paystack webhook | `apps/local-guest/src/guest-server.ts` (returns 200 on internal error; nothing re-drives it) |
| Owner back office | `apps/local-owner/src/local-owner-environment.ts`: stale vs expired read from error text; owner queue re-lists request statuses |

### Browser client (`apps/local-guest/src/client.ts`)

| State | Note |
|---|---|
| Flags: `isLoading`, `eventInFlight`, `taskEventInFlight`, `criteriaInFlight` | No single request phase (issue 22) |
| `agentMarkState` | Reducer (explicit) |
| `shellState.focusedSurfaceOpen` and surface status | Uses the `conversational-shell.ts` union |
| `data-state`, `data-status`, `data-mode`, `data-focused`, `data-waiting`, `data-expanded`, `data-empty`, `data-page-hidden` | DOM attributes used as state |
