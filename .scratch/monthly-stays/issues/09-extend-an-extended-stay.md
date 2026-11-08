# Extend an Extended Stay

Status: ready-for-agent
Type: task
Blocked by: 06, 17, 18

## What to build

The guest can add Billing Periods (the last may be shorter, priced per night) to a confirmed Extended Stay through a Booking Amendment (ADR 0060, ADR 0092 "Extensions").

- Check availability for the added nights, a fresh quote at the current Monthly Agreed Amounts, Request to Book approval, and validity of inspection and authority through the new checkout (ADR 0056, ADR 0057).
- The total length must stay within the Extended Stay range. Adding periods appends new Billing Periods and Period Owner Payables. Existing periods are never repriced.
- Extensions cannot be agreed in chat or arranged off-platform (ADR 0023).

## Refresh (8 Nov 2026)

Since this issue was written:
- Extended Stays run **30 to 180 nights** in every deployment (ADR 0092 as amended 1 Nov 2026). "The Extended Stay maximum" in AC2 is the policy's `maximumNights` (180).
- `domains/shortlet/src/booking-amendment.ts` still refuses any amended stay over `MAX_STAY_NIGHTS` (29), so no Extended Stay can be lengthened. For a contract whose stay type is Extended, the length check must use the Extended Stay policy instead; a Short Stay keeps the 29-night cap (extending a Short Stay to 30+ nights is not an extension, ADR 0023 as amended).
- Continuous Occupancy (short-stays-29-nights issue 06) applies to extensions: the whole chain must stay within 180 nights.
- Notice to End (issue 17) and extensions both amend the contract: an extension must refuse while a Notice to End is in force, and vice versa, unless ADR 0092 says otherwise (check; ask if unclear).
- Guest entry point: the same confirmed-booking chat surface and button-only confirmation pattern as issue 18, with a confirmation step that shows the added periods, their amounts and due dates before the Request to Book is sent. Proposed labels, for the owner to confirm: action "Extend your stay"; confirm button "Request extension".

## Acceptance criteria

- AC1: An extension request with available nights, operator approval and valid inspection and authority commits as a Booking Amendment that appends priced periods.
- AC2: An extension that would exceed the Extended Stay maximum is rejected before quoting.
- AC3: An extension whose new checkout falls after inspection or authority expiry is rejected.
- AC4: If any night in the extension is unavailable, the extension is rejected and the original contract is unchanged.
- AC5: Existing periods, their amounts and their payables are unchanged by an extension.
- AC6: An extension that would make the Continuous Occupancy chain longer than 180 nights is refused.
- AC7: With the assistant enabled and a cold restore before every event, a guest can request an extension from the confirmed booking and sees the added periods before sending; refusals are `tool_denial`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 | 30–90 nights; "Extensions" |
| 0060 | Versioned amendment, atomic |
| 0023 | No informal extensions |
| 0056, 0057 | Validity through the new checkout |
| 0015 | Fresh quote |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments

- **8 Nov 2026, Claude (not started; blocked, status left `ready-for-agent`).** Read the issue, issues 17 and 18 (Comments), AGENTS.md, ADR 0092 (Billing Periods, Notice to End, Extensions), 0060, 0023, 0092 extension clauses, and the code paths below. No code was written for AC1–AC7 and no tests were added. Reasons, each verified in the tree:
  1. **Dependency 06 is open.** `.scratch/monthly-stays/map.md` row 06 is `ready-for-agent`, and this issue is `Blocked by: 06, 17, 18`. 17 and 18 are resolved. 06 is not, so 09 cannot be closed on top of it. Billing Period quoting and append code exists (`domains/shortlet/src/period-payment.ts`, `owner-payable.ts`, `quote.ts`, `extended-stay-changes.ts`), but 06's own acceptance criteria are not recorded as passing.
  2. **No Request to Book approval for amendments (design gap).** ADR 0092 "Extensions" requires Request to Book approval. `domains/shortlet/src/booking-amendment.ts` has only guest acceptance (`acceptAmendment`) and a trusted-backend commit (`commitAmendment`); there is no operator approval step. The only operator approval in the tree is for Booking Requests (`apps/local-guest/src/fixture.ts:765` `simulateOperatorAcceptance`, and `apps/local-guest/src/assistant/shortlet-stage-handlers.ts:207`). Routing an extension through a new Booking Request is a design decision for the owner, not something to improvise.
  3. **Length cap is still 29 for every amendment.** `booking-amendment.ts` (the `request` method) throws `Stay length exceeds the maximum Short Stay limit of ${MAX_STAY_NIGHTS} nights` for any contract, so an Extended Stay cannot be lengthened. The fix is specified in the Refresh section (use the Extended Stay policy for Extended contracts, keep 29 for Short Stays). That is a small change, but it has no effect until 2 is decided.
  4. **Notice exclusivity is not enforced.** No code checks for an in-force Notice to End when an amendment is requested, or for a pending extension when a notice is given. ADR 0092 does not say otherwise, so this follows the issue text.
- **Next step for the owner.** Confirm (a) that 06 is accepted as resolved, or that 09 may proceed on the current Billing Period code; and (b) the approval route for an extension (for example, an operator-approved Booking Request that carries the amendment, or a new operator approval step on amendments). Once decided, the work order is the tests-first list in the issue, AC1–AC7 plus the three named tests.
- **Strings proposed (not added to the code).** "Extend your stay" (action); "Request extension" (confirm button).

- **8 Nov 2026, Claude (implemented; NOT resolved, status left `ready-for-agent`).** The coordinator's answers were applied: (1) dependency 06 is treated as satisfied on the current Billing Period code (`period-payment.ts`, `owner-payable.ts`, `quote.ts`, `extended-stay-changes.ts`); the map row 06 is stale. (2) Owner decision (8 Nov 2026): the Operator approves or declines an extension in the back office within the Operator Response Window (`OPERATOR_RESPONSE_WINDOW_MINUTES` = 30, `booking-request.ts`, reused); approval commits at once and appends the periods and payables, with nothing paid at approval; decline or no reply (lazy expiry at the clock) changes nothing and the guest is told; the guest's "Request extension" is the consent.
- **Implementation (commit 3fb1018).**
  - Domain: `domains/shortlet/src/extended-stay-extension.ts` (`ExtendedStayExtensionManager`: `previewNextPeriod`, `preview`, `requestExtension`, `approveExtension`, `declineExtension`, `statusOf`; closed `ExtensionRefusalCode`); the period pricing extracted from `createStayQuote` into `planExtendedBillingPeriods` / `periodsWithExtras` / `extendedStayExtensionPeriods` (`quote.ts`, existing quote tests unchanged, 132/132); `inspectionAndAuthorityCoverCheckout` exported from `browse.ts` (the booking path's rules); `extensionRequest` on `BookingContract`; the Notice to End guard refuses while an extension awaits the Operator (`extended-stay-changes.ts`).
  - Versioning: request, decline, expiry and approval each move the contract one version through `mutateContract` (ADR 0060). The request stays on the contract, so the state survives a cold restore and is shared with the back office.
  - Chat: closed intent `extend_booking` (classifier, scripted model); preview-only planner tool `propose_extension`, mapped only from `extend_booking` (never `support`); the card (`pending-action-a2ui.ts`) and button-only confirmation (`extensionHandler` in `shortlet-stage-handlers.ts`); `request_extension` is NOT on `TEXT_CONFIRMABLE_ACTION_TYPES`; the open event `shortlet.assistant.open-extension` (`EXTENSION_OPEN_EVENT`, `booking-contract-a2ui.ts`); persisted reference fields added to the fail-closed projection whitelist (`guest-projection.ts`).
  - Owner back office: `listExtensionRequests`, `approveExtensionRequest`, `declineExtensionRequest` (`local-owner-environment.ts`, which checks the representative grant for the contract's Operator first); the "Extension requests" section with Approve and Decline forms and POST routes `/operator/extensions/:contractId/:extensionId/(approve|decline)` (`local-owner-server.ts`).
- **Design points taken conservatively (decisions, not owner-confirmed).**
  1. The extension adds one Billing Period of the policy length (`billingPeriodNights`), or the nights left under the 180-night maximum when fewer. The guest never names a number of nights in chat, so no model-proposed date is trusted; the card shows the exact dates and the guest sends that request.
  2. Added periods start at the current checkout and are numbered after the existing ones, so existing periods, amounts and payables are untouched (AC5).
  3. Approval re-quotes the segment and refuses with `QUOTE_CHANGED` if the amounts moved, instead of silently committing a different price.
  4. The Short Stay cap is enforced by refusing every extension of a Short Stay (`NOT_EXTENDED`); a Short Stay is never lengthened.
  5. Continuous Occupancy reads the same counted-stay ledger as the booking path (`BookingRequestManager.continuousOccupancy`, exposed read-only).
  6. The chat card and confirmation show the requested and outcome states from the artifact (`extensionFacts`, `booking-contract-artifact.ts`); the page is not changed (there is no page route for extensions).
- **Tests (files and counts).**
  - `test/extended-stay-extension.test.ts`: 12 of 12 pass. AC1 to AC6 by name, the Operator approve, decline, expiry and non-operator cases, the Short Stay refusal, and Notice to End exclusivity both ways.
  - `test/extension-chat.test.ts`: 6 of 6 pass. AC7 (cold restore before every event; the added period shown before sending; the request; approval reflected on the booking screen), "Typed confirmations (yes, ok, confirm, go ahead) with an extension card open never send an extension request", "A Short Stay cannot be extended to 30 nights or more", the support request, the Notice to End refusal, and the open event.
  - `test/extension-owner-inbox.test.ts`: 5 of 5 pass (the inbox lists the request; approve appends; decline changes nothing; no reply expires; a guest cannot approve). These run the owner environment on the same SQLite store; the HTTP route itself is not covered by an automated test (noted as a gap).
  - Updated pinned list in `test/assistant-stage-handlers.test.ts` (criterion 6) for the new `extension` stage: 8 of 8 pass. `test/helpers/notice-chat-journey.ts` extended (`STAY_LONGER_TEXT`, `coldRecording` moved here).
  - Affected list from the coordinator (19 files, 187 tests): 187 of 187 pass (run before the test-only tidy-up of `extension-chat.test.ts`; the three extension files were re-run afterwards, 23 of 23).
  - Broader run (185 files that import the touched modules, batches of 30 under `browser.lock`): batch-00 212 of 212 pass; batch-01 205 of 209 pass, with 3 failures in `commerce-surfaces-chromium.test.ts` and `commerce-store-pages.real-browser.test.ts` (the accepted commerce failures); batch-02 304 of 304 pass. Batches 03 to 06 were still running when this note was written (they are slow real-browser runs); their results are not recorded here.
  - `env -u LLM_API_KEY npm run check`: exit 0 on the committed tree (3fb1018).
- **Not done (issue stays open).** (a) The extension capture: `.scratch/guest-ui-consistency/capture-09-extension.ts` (copied from capture-18; it writes to `screenshots/09/`, with new names `chat-extension-card-*` and `chat-extension-requested-*`) is queued behind the browser lock and has not produced output yet. (b) The Definition of Done's full batch results (batches 03 to 06). (c) An HTTP-level test of the owner inbox routes. (d) `guest-confirmation-system-chromium.test.ts` was not run.
- **Owner strings (new, for confirmation).** Labels proposed in the issue: "Extend your stay" (action and heading), "Request extension" (confirm). Other new strings in `GUEST_EXTENSION_COPY` (`apps/web-agent/src/guest-content.ts`): "Not now"; "Extending applies to an Extended Stay. A Short Stay cannot be extended to 30 nights or more from here."; "A Notice to End is in force, so this stay cannot be extended."; "An extension request is already waiting for the Operator."; "The unit is not available for every added night, so the stay cannot be extended."; "The inspection or Management Authority does not cover the new checkout, so the stay cannot be extended."; "An Extended Stay is at most 180 nights in total, so the stay cannot be extended further."; "This stay cannot be extended right now."; "Here is the extension and what it adds. Press Request extension on the card to send it to the Operator. Nothing is agreed until the Operator approves."; "Extension requested. The Operator will reply by the time shown below. Nothing is added until they approve."; "Extension agreed. Your stay now ends on the new checkout."; "The Operator could not extend your stay. Nothing has changed."; "The Operator did not reply in time, so the extension was not made. Nothing has changed."; "The extension terms have changed. Ask again to see the current terms."; "Added nights"; "New checkout"; "Added amount (paid as each period falls due)"; "Due date for the added period"; "Operator replies by". Owner-side strings: "Extension requests", "Approve extension", "Decline extension", "Only the Operator can decide an extension".
- **Process notes.** A stray `send_message` call was made with a placeholder session id; it was refused and nothing was sent. A first draft of the capture overwrote the committed `.scratch/guest-ui-consistency/capture-09.ts` (demo-launch issue 09); the draft was moved to `capture-09-extension.ts` and the committed file restored with `git checkout`. Test runs regenerated some tracked PNGs under `.scratch/ui-phase3-discovery-detail/` (unstaged, not committed).
