# 17 · Wire Notice to End into the guest and owner apps

Status: claimed
Type: task
Blocked by: none
Requested: 8 Nov 2026

## Why

Every Extended Stay contract shows "Notice to End: …" (ADR 0092), but on `main` (8 Nov 2026) no app composition constructs `NoticeToEndManager` (`domains/shortlet/src/extended-stay-changes.ts`), so a guest cannot give notice. Read monthly-stays issue 08 first: its Notice to End criteria (AC3–AC6) describe the domain rules; this issue makes them reachable.

## Owner decision (8 Nov 2026)

The guest gives notice **in the chat, from the confirmed booking, with a confirmation step** that shows the new last night and the money effect before anything changes. The Operator sees the change in the back office.

## What to build

1. **Compositions.** Construct `NoticeToEndManager` in `apps/local-guest/src/fixture.ts` and `apps/local-owner/src/local-owner-environment.ts` with `EXTENDED_STAY_POLICY` (or `config.extendedStayPolicy`) and `demoTerms: config.demo === true`, in every deployment (ADR 0092 as amended). Check the Cloudflare composition uses these environments; if it builds its own, wire it there too.
2. **Guest flow (chat and the standalone confirmation page, same helper, ADR 0077/0080).** On a confirmed Extended Stay **after Verified Access** (ADR 0092), offer a "Give notice to end your stay" action. It opens a confirmation step showing, from the domain's own calculation:
   - the new last night and the new checkout date;
   - paid nights after the new last night and the refund at nightly contracted values;
   - any unpaid nights up to it and what is owed.
   The guest confirms or goes back. Confirming records the versioned Booking Amendment (ADR 0060); nothing changes before that. Before Verified Access, or on a Short Stay, the action is not shown, and a forged event is refused (`STALE_SURFACE` / `ARTIFACT_MISMATCH`, fail closed).
3. **Assistant.** A guest who asks in chat to end early is offered the same confirmation step through a structured surface; the assistant never records notice from free text alone. Out-of-scope or refused requests are `tool_denial`, never `CONCIERGE_UNAVAILABLE` (ADR 0106). Persist and re-key the surface id on cold restore (AGENTS.md "Concierge assistant path").
4. **Owner side.** The back office booking view shows the notice (date given, new last night, refund due, owed amount) and the reduced Period Owner Payables (ADR 0089, 0092).
5. **Wording.** Use existing labels and terms where they exist (`GUEST_FACT_LABELS`, the contract's Notice to End terms). For anything new (the action label, the confirmation heading, button labels), use these proposed strings and mark them in Comments for the owner to confirm: action "Give notice to end your stay"; heading "End your stay early"; confirm button "Give notice"; back button "Keep my stay".
6. **Not in scope:** refunds are recorded, not paid out (payouts stay manual, ADR 0089); the lawful process for unpaid periods stays `[counsel text]`.

## Acceptance criteria

- AC1: Every composition (production, staging, demo) can record a Notice to End; the stale "needs an Extended Stay policy" refusal is unreachable in a composition.
- AC2: After Verified Access, the guest sees the action on a confirmed Extended Stay, and the confirmation step shows the new last night, refund and amount owed calculated by the domain.
- AC3: Going back changes nothing; confirming commits one versioned Booking Amendment, and the contract's last night, Billing Periods and Period Owner Payables update.
- AC4: Before Verified Access, on a Short Stay, or with a forged or superseded surface id, the action is refused and nothing changes.
- AC5: With the assistant enabled and a cold restore before every event, a guest asking to end early reaches the same confirmation step and can confirm it; refusals are `tool_denial`.
- AC6: The back office shows the notice and the reduced owner payables.
- AC7: Guest UI passes ADR 0078 checks (no overflow, 44px targets, light and dark); captures at 320, 390, 768 and 1280 under `screenshots/17/` (AGENTS.md "Guest UI work").

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 (amended) | Notice to End after Verified Access; 14-day rule; refunds at nightly contracted values; owner payables fall |
| 0060 | Versioned Booking Amendment; original stays authoritative until commit |
| 0105 | Demo label only in demo mode |
| 0106 | Cold restore, persisted surface ids, `tool_denial` |
| 0077, 0080 | Same helper and content for chat and page |
| 0078 | Accessible launch profile |
| 0089 | Owner payables per period; payouts manual |

## Definition of Done

See `docs/agents/issue-tracker.md` and the AGENTS.md capture rules. Record commands and pass counts in Comments.

## Comments

- **8 Nov 2026, Claude (partial; left `claimed`, not `resolved`).** The guest page, the composition wiring, the owner back-office notice and the domain preview/confirmation are done and tested. The chat entry (AC2/AC3 in chat), the assistant (AC5) and the captures (AC7) are not built; see "Open" below.
- **Files.** `domains/shortlet/src/extended-stay-changes.ts` (`previewNotice`; `giveNotice(contractId, principal, confirmation?)` binds the notice date and contract version; shared `#prepare` guard; `checkInNoticePorts` (Verified Access and open failures from the check-in store, fail closed); `recordedNoticeRefundPort` (refund recorded, not paid out)); `domains/shortlet/src/card-payment.ts` (`noticeToEnd.refundKobo/owedKobo`; `CardPaymentManager.replaceBookingContract`); `apps/web/src/card-payment-application.ts` (pass-through); `apps/local-guest/src/fixture.ts` (manager constructed); `apps/local-owner/src/local-owner-environment.ts` (manager constructed, `notice` on the back-office payable, notice adjustments passed to the period projection); `apps/local-guest/src/guest-server.ts` (`GET`/`POST /bookings/notice/:offerId`, entry link on the schedule page); `apps/local-guest/src/guest-kit.ts` (`noticeConfirmationHtml`, `noticeRecordedHtml`, `noticeActionLinkHtml`); `apps/web-agent/src/guest-content.ts` (`GUEST_NOTICE_COPY`); `test/notice-to-end-wiring.test.ts` (new, 8 tests); `test/helpers/guest-route-harness.ts` (new).
- **ADRs read and applied.** 0092 (amended): Notice to End only after Verified Access, new last night = night before the date 14 days after notice, paid nights refunded at nightly values, unpaid nights owed at nightly values; the 14-day and 180-night values come from the existing policy. 0060: the notice commits as one versioned contract mutation with an expected-version check; the original stays valid until commit. 0061: an open failure or failed access routes away from the voluntary notice (`hasOpenFailure`). 0089: refunds are recorded (`pending`, no PSP call) and owner payables fall per period. 0080: the confirmation is a deterministic route with the same command as any future chat path; nothing changes on GET. 0077/0075: one copy source (`GUEST_NOTICE_COPY`) and no ids in copy. 0078: no page-level `style` strings; new markup uses kit classes (`ui-panel`, `ui-button`). 0106: not yet exercised (assistant not built).
- **Commands and counts** (run in `/home/user/chat-marketplace/.worktrees/notice`):
  - `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/notice-to-end-wiring.test.ts`: 8 tests, 8 pass, 0 fail (after the final edit).
  - Regression set, same env: `test/notice-to-end-wiring.test.ts test/demo-extended-cancellation-notice.test.ts test/later-period-payment-routes.test.ts test/pay-each-demo-billing-period.test.ts test/owner-payable-per-period.test.ts test/extended-stays-every-deployment.test.ts test/confirmation-schedule-link.test.ts test/continuous-occupancy.test.ts test/assistant-continuous-occupancy.test.ts test/demo-extended-stay.test.ts`: 102 tests, 102 pass, 0 fail.
  - Kit and guard tests: `test/guest-kit.test.ts test/guest-retired-classes.test.ts test/shortlet-ui-foundations.test.ts test/guest-content*` (matched files): 16 tests, 15 pass, 0 fail, 1 skipped by the runner.
  - `env -u LLM_API_KEY npm run check`: clean (tsc, cloudflare, test, tooling, worker bundle guard).
- **AC status.**
  - AC1 (every composition constructs the manager): named test passes. **Gap:** tested through the demo composition (`production: true, demo: true`); a non-demo production composition is not exercised because it needs live Paystack configuration.
  - AC2 (action and confirmation step after Verified Access, figures from the domain): page test passes (new last night 23 Sep 2026, refund for 16 paid nights, owed ₦0). Before Verified Access and a Short Stay: both refused. **Open:** the chat action is not built, so the chat half of AC2 is not met.
  - AC3 (going back changes nothing; confirming commits one version, moves the checkout, owner payable of period 1 falls): passes. **Open:** the chat confirmation is not built.
  - AC4 (forged, stale or superseded confirmation refused): passes for a wrong notice date, a wrong contract version and an unknown offer id. The refusal code on the page is `NOTICE_NOT_AVAILABLE` (HTTP 400); the chat codes `STALE_SURFACE` / `ARTIFACT_MISMATCH` do not apply until the chat surface exists.
  - AC5 (assistant, cold restore before every event): **not built**.
  - AC6 (back office shows date given, new last night, refund due, owed, reduced payable): passes through `ownerPayable(requestId, operator)` (`notice` view and period 1 `ownerPayableKobo`). The back-office page template itself is not changed; the data is on the payable view.
  - AC7 (captures at 320, 390, 768, 1280 under `screenshots/17/`, overflow and 44px checks, light and dark): **not done**. The new `dl.notice-facts` and `.notice-step` classes have no kit CSS yet.
- **Proposed-for-owner strings (issue 17 item 5), used as written:** action "Give notice to end your stay"; heading "End your stay early"; confirm "Give notice"; back "Keep my stay". New labels with no existing kit term, also for owner confirmation: "New last night", "New checkout", "Refund for paid nights after it", "Still owed up to it", heading "Notice given" and the lead "Your stay now ends on the new last night below. Refunds are paid by hand, as the terms say." The terms line is the domain's `noticeToEndTerms` ("Demo terms for a synthetic staging booking: the stay ends 14 days after notice, ...").
- **Open (not done).**
  1. Chat entry, the confirmation step and the chat confirmation (AC2 and AC3 chat half). The shared markup helpers exist; the chat surface and its event wiring in `apps/local-guest/src/shortlet-app.ts` do not.
  2. Assistant (AC5): the intent route, the structured surface, the cold-restore re-keying of the surface id and the `tool_denial` refusals per ADR 0106.
  3. Captures and the ADR 0078 checks (AC7), under the browser lock. The page needs kit CSS for the definition list first.
  4. Test duplication: `test/later-period-payment-routes.test.ts` still has its own `send` and `cookieOf`. The new `test/helpers/guest-route-harness.ts` should replace them; not done to keep this change to one issue.
- **Risks and decisions to review.**
  - Cache: `CardPaymentManager` caches contracts per process. The notice updates the cache only in the process that commits it, so another isolate can read the old version until a restart. The same is true of existing amendments. The composition calls `replaceBookingContract` after each commit, which covers this process only.
  - Refunds: recorded as `pending` on the amendment with a stable reference; nothing is paid. The owner sees `refundKobo` on the payable, but no owner refund obligation record exists yet.
  - `refundKobo` and `owedKobo` are stored on the contract's `noticeToEnd` (optional fields). For a record without them the page shows zero. No such record exists in practice, because no composition constructed the manager before this change.
  - The owner composition reads a period as paid from the period-payment rows and period 1 as paid from the contract. It does not use the card-payment period projection.
- **No commit to main, no push, no deploy.** No screenshots were generated or changed. `dist/*.js` and `_headers` were not touched.

- **Follow-up, 8 Nov 2026 (coordinator review).** Commits: `b344c35` (kit compliance and non-demo AC1 test); `b49fb0c` (issue 07 assistant-level extended-chain and fail-closed tests). Status stays `claimed`: AC2/AC3 chat, AC4 chat codes, AC5 and AC7 are not met.
  1. **Kit compliance (done).** `dl.notice-facts` is now `dl.ui-facts.ui-facts--stacked` with direct dt/dd children, as in the transfer and booking details. The `notice-step`, `notice-recorded` and `notice-facts` classes are gone; `data-notice-step`/`data-notice-recorded` are test hooks. No new CSS was added.
  2. **AC1 non-demo (done).** Test `AC1 non-demo: a production composition with demo off records a Notice to End for a confirmed Extended Stay` (`LocalGuestEnvironment.openNode({ demo: false, deployment: "production" })`, no Paystack client; the Extended Stay contract is stored through `SqliteBookingStateRepository.saveContract`, verified access through the check-in store). The guest composition's periods port now reads the interaction store (period 1 paid, later periods from the period-payment rows), as the owner composition does. This removes the dependency on the card-payment contract cache.
  3. **Chat half of AC2/AC3/AC4 (not done).** The chat "Give notice to end your stay" action needs a pack-level entry. Plan: a pending action of kind `give_notice` (`apps/local-guest/src/assistant/pending-actions.ts` closed union), a planner tool `propose_notice_to_end` in the shortlet pack, a stage handler whose `project` checks `previewNotice` and places the confirmation card, and `confirm` runs `giveNotice` with the noticeDate and contractVersion stored on the pending action. Confirm and cancel use the runtime's existing `ASSISTANT_CONFIRM_ACTION_EVENT` / `ASSISTANT_CANCEL_ACTION_EVENT` with its surface checks (`STALE_SURFACE`). Two things to settle first: the runtime's text-confirmation words ("yes", "ok") must not confirm a `give_notice` pending action, and the confirm card's labels must be the notice copy (`GUEST_NOTICE_COPY`), not generic ones. The runtime's `platformActionNames` path is tied to the `<pack>:checkout` stage, so it is not reused.
  4. **AC4 chat codes (not done).** The page refuses forged, stale and superseded confirmations with `NOTICE_NOT_AVAILABLE` (400). The chat path must return `STALE_SURFACE` / `ARTIFACT_MISMATCH`, which needs the chat surface in item 3.
  5. **AC5 assistant (not done).** Depends on item 3. Tests must use the assistant with a cold restore before each event, clock 2026-10-27 and a staging-like guest; a Short Stay or a pre-Verified-Access refusal is a `tool_denial` (`AssistantGuestRefusalError`), never `CONCIERGE_UNAVAILABLE`; `test/assistant-pack-registry.test.ts` must keep passing.
  6. **AC7 captures (not done).** No capture was run and no screenshot was generated. The page and chat captures need the walkthrough under `flock browser.lock`, after items 3 and 5 settle the chat screen.
  - **Issue 07 gap (closed).** `test/assistant-continuous-occupancy.test.ts`, AC9 (extended chain: 31-night candidate meets a 150-night prior, 181 nights, sentence "making 181 nights in a row. The longest stay we can book is 180 nights.") and AC10 (fail closed: a counted stay on a second Unit loses its Property after its draft is made, so the guard refuses before any hold, sentence "We couldn’t check these dates ..."). Both are `CONTINUOUS_OCCUPANCY_REFUSED` through the assistant. Counts: `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-continuous-occupancy.test.ts` -> 4 tests, 4 pass, 0 fail.
  - **Counts for the follow-up set** (same env): `test/assistant-continuous-occupancy.test.ts test/continuous-occupancy.test.ts test/notice-to-end-wiring.test.ts test/assistant-pack-registry.test.ts test/assistant-cold-journey.test.ts test/guest-retired-classes.test.ts test/guest-kit.test.ts test/shortlet-ui-foundations.test.ts test/demo-extended-cancellation-notice.test.ts test/owner-payable-per-period.test.ts test/later-period-payment-routes.test.ts` -> 101 tests, 100 pass, 0 fail, 1 skipped by the runner. `npm run check` exit 0 on the committed tree.
  - **Strings for owner confirmation.** No new strings in this follow-up.

- 8 Nov 2026, **orchestrator: scope split.** The chat half of AC2–AC4 and AC5 (assistant) move to issue 18, which needs a new confirmation kind designed against ADR 0106. Issue 17 is complete when the page path, compositions and back office (done) and **AC7 captures of the standalone notice page and recorded state** are done. The page is reachable from the chat today through "View payment schedule" on the confirmed booking.

