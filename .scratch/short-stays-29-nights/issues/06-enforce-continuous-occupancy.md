# 06 · Enforce Continuous Occupancy across back-to-back stays

Status: resolved
Type: task
Blocked by: 04 (resolved)
Requested: 1 Nov 2026

## What to build

ADR 0023 and ADR 0092 (amendments of 1 Nov 2026) cap **Continuous Occupancy**, not just single bookings, but no code adds up back-to-back stays today. Using the owner's decisions in issue 04:

- **Chain.** For a new or changed stay, find the guest's other *counted* stays at the same Property (`Unit.propertyId`, any Unit) by the same Primary Guest account whose checkout equals this stay's check-in, or whose check-in equals this stay's checkout, and follow the chain both ways. A gap of one night or more ends it.
- **Counted stays**: stays that still hold or will hold the nights: a submitted Booking Request awaiting the Operator, an open Conditional Offer, a confirmed Reservation (and any equivalent held state you find). Not counted: declined, expired, withdrawn, cancelled, superseded drafts. List the exact states you count, with file and line, in Comments.
- **Rules** (total = nights of the whole chain including the new stay):
  - every stay in the chain is a Short Stay → total ≤ `MAX_STAY_NIGHTS` (29);
  - any stay in the chain is an Extended Stay → total ≤ the policy's `maximumNights` (180).
  Take both limits from the existing constant and policy; add no new constant.
- **Where.** Booking Request draft creation and submission (`domains/shortlet/src/booking-request.ts`), and Booking Amendments that change dates (`booking-amendment.ts`). Refuse before any inventory hold, quote acceptance or payment, as ADR 0023 requires. Fail closed: if a counted stay's Property or Primary Guest cannot be resolved, refuse rather than skip it.
- **Message.** Reuse an existing refusal pattern if one fits. Otherwise use: "These dates join another stay of yours at this property, making {total} nights. A stay of 30 nights or more must be booked as one Extended Stay." (Short chain) and "These dates join another stay of yours at this property, making {total} nights, more than the {max}-night maximum." (Extended chain). Mark both in Comments as **wording for the owner to confirm**.
- **Guest surfaces.** The concierge and assistant must report the refusal as a normal refusal (assistant: `tool_denial`, never `CONCIERGE_UNAVAILABLE`, ADR 0106).

## Acceptance criteria

- AC1: A guest with a confirmed 20-night Short Stay at Property P cannot submit a Booking Request at another Unit of P that checks in on that checkout date for 10 nights (30 in total); the refusal names the total, and no nights are held.
- AC2: The same guest can book 9 nights there (29 in total).
- AC3: A one-night gap breaks the chain: 20 nights, a gap night, then 20 nights is allowed.
- AC4: A different guest account, or a different Property, is never added to the chain.
- AC5: Declined, expired and cancelled stays are not counted; a pending Booking Request and an open Conditional Offer are counted.
- AC6: A chain that includes an Extended Stay may reach 180 nights and is refused at 181.
- AC7: A Booking Amendment that extends a stay into a chain over the limit is refused.
- AC8: With the assistant runtime enabled and a cold restore before every event (AGENTS.md "Concierge assistant path"), the AC1 refusal reaches the guest as a refusal, not `CONCIERGE_UNAVAILABLE`.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 (amended 1 Nov 2026) | Continuous Occupancy across Units and reservations; Short Stays ≤ 29; refuse before search, quoting, blocking or payment | All ACs |
| 0092 (amended 1 Nov 2026) | Chain with an Extended Stay ≤ 180 | AC6 |
| 0060 | Amendments are versioned and validated | AC7 |
| 0106 | Refusals are `tool_denial`, cold restore per event | AC8 |
| 0075 | No guest identifiers in refusal text or logs | Message, audit |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments

**2026-11-01 (agent, branch `feat/continuous-occupancy`).**

*Files.* New: `domains/shortlet/src/continuous-occupancy.ts` (pure chain function `assessContinuousOccupancy`, `ContinuousOccupancyLedger`, `assertContinuousOccupancy`, `ContinuousOccupancyError`, `continuousOccupancyRefusal`), `test/continuous-occupancy.test.ts`, `test/assistant-continuous-occupancy.test.ts`, `test/helpers/continuous-occupancy-fixture.ts`. Changed: `domains/shortlet/src/booking-request.ts` (createDraft, disclose, optional `bookingState`, `#countableRequests`), `domains/shortlet/src/booking-amendment.ts` (required `continuousOccupancy`, guard in requestAmendment when `changes.dates`), `domains/shortlet/src/guest-interaction-store.ts` (new `listConditionalOffersByRequestId`, `findBookingRequestsForPrimaryGuest`), `domains/shortlet/src/index.ts` (export), `apps/local-guest/src/shortlet-app.ts` (refusal mapped to `GuestRejection` `CONTINUOUS_OCCUPANCY_REFUSED` at Request to Book and submit), `apps/local-guest/src/assistant/assistant-runtime.ts` (refusal treated as `tool_denial`, server sentence as reply), `apps/local-guest/src/fixture.ts` and `apps/local-owner/src/local-owner-environment.ts` (pass `bookingState` into the request application), `test/amend-material-booking-terms.test.ts` and `test/short-stay-29-nights.test.ts` (supply a ledger). Map and status updated.

*Counted states (file:line in `continuous-occupancy.ts`).*
- Counted: request `disclosed` (awaiting the Operator), line 203; request `confirmed` with no offer yet (issuance pending), line ~200; offer `issued`, line ~208; offer `accepted` with no booking snapshot (Payment Window), line ~220; offer `accepted` with a snapshot and a `confirmed` Reservation (dates from the contract), line ~236 onward.
- Not counted: request `declined`, `expired` (projected at the clock, `projectBookingRequestStatus`), `delivery_failed` (lines 161–162); offer `expired`, `stale`, `revoked` (line 164); Reservation `cancelled` or `no_show` (line 236).
- Unknown status values fail closed (throw), never skipped.
- Chain: adjacency is an exact checkout equal to a check-in, both directions, same `propertyId`, same Primary Guest (`assessContinuousOccupancy`, line 75). Limit: `MAX_STAY_NIGHTS` for an all-Short chain, `EXTENDED_STAY_POLICY.maximumNights` when the chain holds an Extended Stay (`chainLimit`, line 63). No new constant.

*Enforcement points.* Draft creation: `booking-request.ts:228` (tenant from the principal when passed, otherwise every tenant of the guest, so existing draft callers keep working). Submission: `booking-request.ts:492`, before the quote, the inventory hold and any payment. Amendment: `booking-amendment.ts` requestAmendment, after the existing length check, with the contract excluded by `contractId` and `offerId`.

*Refusal wording (for owner confirmation).* Short chain: "These dates join another stay of yours at this property, making {total} nights. A stay of 30 nights or more must be booked as one Extended Stay." (30 derived as `MAX_STAY_NIGHTS + 1`). Extended chain: "These dates join another stay of yours at this property, making {total} nights, more than the {max}-night maximum." Also new, not in the issue, for fail-closed cases (an unreadable Property, Primary Guest or status, or an Extended chain with no policy): "These dates cannot be checked against your other stays at this property." **Owner to confirm all three.** No guest, request or contract id appears in any message.

*ADRs read and applied.* ADR 0023 (amended 1 Nov 2026): chain rule, anti-fragmentation, refusal before hold, quote and payment. ADR 0092 (amended 1 Nov 2026): 180-night chain with an Extended Stay. ADR 0060: amendments validated and versioned; the new check runs before the atomic mutation. ADR 0106: refusal is a rejected tool call or an ordinary guest refusal, never CONCIERGE_UNAVAILABLE. ADR 0075: no guest identifiers in messages or logs. ADR 0041/0043: projected request status. ADR 0057 (management authority) and ADR 0085 (phone is a separate input) are relevant to the fixture only.

*Tests and commands (all run from the worktree with `env -u LLM_API_KEY`).*
- `npx tsc --noEmit -p .`: clean (after each change).
- `npx tsx --test test/continuous-occupancy.test.ts`: 12 tests, 12 pass. AC1–AC7 each one named test; plus direct tests of `assessContinuousOccupancy`, the fail-closed ledger, and the wording.
- `npx tsx --test test/assistant-continuous-occupancy.test.ts`: 1 test, 1 pass (AC8, cold restore before every event, assistant enabled, clock 27 Oct 2026).
- Affected set, group 1: 110 tests, 110 pass, with `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow` (amend-material, short-stay-29-nights, submit-and-resolve-timed, issue-and-accept, domain-boundary, extended-stays-every-deployment, integrate-booking-request/conditional-offer, response-window, operator-request-inbox, guest-request-handler, and the two new files).
- Affected set, group 2: 144 tests, 144 pass, with the same variables (assistant-short-stays-29-nights, assistant-cold-journey, assistant-thread-lock, demo-extended-assistant, demo-extended-cancellation-notice, demo-extended-stay-180, demo-extended-stay, conditional-offer-token-restore, demo-auto-accept, guest-contact-pilot, http-shim-multipart, paystack-transfer-adapter, provider-issued-transfer-account).
- One earlier run of group 2 without those variables gave 152 pass and 1 fail: "ADR 0101: a handler composed with commerce locally creates the commerce tables" (`guest-request-handler.test.ts`) threw "COMMERCE_REFERENCE_HMAC_KEY ... must be set". It is an environment setting, not this change; the file passes 9/9 with the variables set.
- `env -u LLM_API_KEY npm run check`: exit 0 (tsc for root, apps/cloudflare, its test and tooling configs, and the worker bundle guard), before the commit. To be re-run after the commit.
- Not run: `npm test` (full) and `npm run test:workers`, which are the once-per-batch pre-merge gate (CLAUDE.md, AGENTS.md "Test scope"). No Cloudflare repository implementation changed (the store is the shared `SqliteGuestInteractionStore`), so no matching `apps/cloudflare/test` spec was run. Definition of Done item 7 (full `npm test`) is therefore deferred to that gate, as the issue's instructions allow.

*AC coverage (named tests).* AC1 "A guest with a confirmed 20-night Short Stay ... (30 in total); the refusal names the total, and no nights are held." (submit-time and draft-time refusal, calendar still free). AC2 "The same guest can book 9 nights there (29 in total)." AC3 "A one-night gap breaks the chain: ..." AC4 "A different guest account, or a different Property, is never added to the chain." AC5 "Declined, expired and cancelled stays are not counted; a pending Booking Request and an open Conditional Offer are counted." (one test, seven scenarios, each on a fresh store, including delivery-failed and expired offer). AC6 "... may reach 180 nights and is refused at 181." (151 refused before the 150-night stay is counted, then 150 allowed). AC7 "A Booking Amendment that extends a stay into a chain over the limit is refused." (32 refused, 17 proposed). AC8 in `assistant-continuous-occupancy.test.ts`.

*Deviations and open items (read these before resolving in the pre-merge gate).*
1. AC8 uses a pending (disclosed) prior request at the same Unit that the search returns, not a confirmed one and not a different Unit of the Property. The different-Unit and confirmed cases are covered at domain level (AC1, AC5). The journey stops at the refusal, but the fixture saves a synthetic phone (`guestContactApp.submitPhone`) so the prior request can be submitted, so this is not the "no seeded phone" staging-like guest.
2. AC8's refusal comes from the Request to Book button event (not a planner tool call), so it is an ordinary guest refusal (`CONTINUOUS_OCCUPANCY_REFUSED`, ADR 0106 allows this). The planner path (`tool_denial`, with the server sentence) is wired in `assistant-runtime.ts` (lines 1370 and 1402) but no test drives a chat turn into it. Add one before live verification if the owner wants the chat path covered.
3. The in-memory path (no store) counts confirmed requests without looking at their offers or Reservations, so it over-counts. Only test and in-memory compositions have no store; the Node and Cloudflare compositions do.
4. An accepted offer without a snapshot (Payment Window) and a confirmed request without an offer are counted: conservative, and it can refuse a stay that will never complete until the offer expires. Confirm with the owner.
5. Draft creation without a principal reads the guest's stays in every tenant. In practice the tenant is always present in production (the guest principal), so this path only affects in-process callers.
6. Pre-existing, not changed: `booking-amendment.ts` still refuses any amended stay over `MAX_STAY_NIGHTS` (29) before the new check, so an Extended Stay cannot be amended to a longer length. Owner decision needed (ADR 0092 "Extensions"). Left as is.
7. No ADR amendment was made; the 1 Nov 2026 amendments are applied as written.
