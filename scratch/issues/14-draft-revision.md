# Draft revision: "make it 3 nights" before submission

Status: resolved
Type: grilling
Blocked by: 04a
Parent: [04](04-never-silent.md)

## What to build

`BookingRequestApplication` offers only `createDraft`, `disclose`, `getArtifact`, `confirm` and `decline` (`apps/web/src/booking-request-application.ts:55–99`), and `BookingRequestManager` has no way to revise a draft. `BookingAmendmentManager` works only on a paid `BookingContract`.

Before any code: write a short design note choosing between a replacement draft that supersedes the old one and a new revise capability. Map it to ADR 0015 (replacement quotes the guest may accept or decline) and ADR 0060, and ask the user to approve any new domain capability. Implementation follows as a task once this is decided.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC3: "make it 3 nights" on a draft proposes a re-quoted draft that needs confirmation.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Distinguish request, offer and reservation truthfully |
| 0060 | Changes after submission are versioned amendments |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Design note (approved by the user, 26 Sept 2026)

**Decision:** a replacement draft, not a new revise capability. No new domain capability is added.

- **Why it is not an ADR 0060 amendment.** A Request Draft is "an undisclosed guest intention … that blocks no inventory and promises neither price nor availability" (`domains/shortlet/CONTEXT.md`). Nothing has been submitted, so there is nothing to amend. ADR 0060 governs changes after submission and is unchanged: `#changeExplanation` still answers for requests, offers, payment and bookings.
- **ADR 0015.** A change of stay produces a fully explained replacement quote that the guest may accept or decline without penalty. It shows the old and new dates, the old and new All-In Stay Total, the Refundable Security Deposit and the total to complete booking, from the same deterministic `createStayQuote` the draft uses.
- **Flow (propose, then accept).**
  1. On the draft stage, a turn that changes dates, nights or party size (no location change) is resolved with `resolveStayRequestContext`. The 14-night and 90-day refusals and the date confirmations are unchanged.
  2. The same unit is revalidated through the discovery query for the new stay (availability and capacity). If it doesn't qualify, the reply says so and the draft is unchanged.
  3. Otherwise a replacement proposal is shown. The current draft stays valid and submittable until the guest accepts.
  4. **Accept** re-quotes. If the figures changed, it re-proposes. If not, it creates a new draft with the existing `BookingRequestApplication.createDraft` (ADR-0072, a platform command) and supersedes the old draft's surfaces, so its Review and Submit go stale.
  5. **Keep** leaves the draft unchanged.
- **The old draft** is left in the store unreferenced. It blocks nothing, so replacing it releases nothing.
- **Found on the way:** after a new search, the old draft's Submit stayed live. `#prepareDiscovery` now supersedes the draft surfaces, while resuming the same stay still re-presents the draft.
- **Rejected alternative:** `BookingRequestManager.reviseDraft` with draft versions and a `superseded` status. It would be a stronger audit trail, but it is a new domain capability and a store schema change that nothing at launch requires.

## Answer

- **Propose (AC3).** `#proposeDraftReplacement` runs at the draft stage, when the draft or its review is on screen. It handles a turn that changes nights, dates or party size without naming a place:
  - It resolves the change with `resolveStayRequestContext`, so the 14-night and 90-day refusals and date confirmations are the discovery ones. It keeps a pending relative-date confirmation in `draftChangeContext`.
  - It revalidates the same unit for the stay through `discoveryQuery.search` (availability and capacity; budget and bedroom preferences ignored).
  - It quotes with `createStayQuote`, the same as the draft.
  - It shows "Change your Request Draft?" (`draftReplacementToA2UI` in `apps/web-agent/src/draft-replacement-a2ui.ts`): the current and new stay, each with its All-In Stay Total; the separate Refundable Security Deposit; the total to complete booking; and "Nothing changes until you choose. Keeping your current draft costs nothing." (ADR-0015).
  - The proposal is in memory (`pendingDraftReplacement`). A restart shows the current draft.
- **Confirm.** "Use the new details" (`DRAFT_REPLACEMENT_ACCEPT_EVENT`, context exactly `{ draftId, basedOn }`):
  - It revalidates and re-quotes. If the price changed, it re-proposes; if the stay is no longer available, it says so and keeps the draft.
  - Otherwise it creates the new draft with `BookingRequestApplication.createDraft` (ADR-0072). It supersedes the old draft's surfaces, moves the criteria and stored results to the accepted stay (undo keeps the previous criteria), and adds the "Draft updated" receipt.
  - "Keep my current draft" (`DRAFT_REPLACEMENT_KEEP_EVENT`) changes nothing.
  - A newer proposal replaces an older one. Stale `basedOn` values, tampered context, and a sent request all fail closed.
- **Not an amendment.** ADR-0060 still applies after submission. `#changeExplanation` is unchanged.
- **Fixed on the way.** `#prepareDiscovery` now supersedes the draft surfaces (when no request exists) and any pending replacement. After a new search, the old draft's Review and Submit are stale; resuming the same stay still re-presents it.
- **Test change.**
  - The M3 test "Request to Book after changing the search starts a draft for the new stay" used "actually make it 3 guests" on a draft. That turn is now this issue's replacement proposal.
  - It now says "… in Old Ikoyi", which is still a new search, so the M3 invariant is still covered.
- **Tests.** `test/guest-draft-revision.test.ts`:
  - AC3: the proposal shows 3 nights and the re-quoted total; nothing changes before accept; accept creates a 3-night draft with the criteria following it; the old draft is stale; a double accept is rejected; the new draft reviews.
  - Failure paths: Keep; over 14 nights; a party the apartment can't take; a tampered, stale or superseded accept; a price change re-proposes; relative dates are confirmed first; a new place still searches and staled the old draft.
  - `restartFixture.advance` takes an optional first message.
- Verification: `npm run check` passed. `npm test`: 1,172 passed, 2 failed, 1 skipped.
  - One failure was the M3 test above, now updated and passing.
  - The other was `pilot-local` AC4 (`spawnSync ETIMEDOUT`), which is known-flaky and passed when rerun alone.
  - Walkthrough on :3001 at 375px and 1280px: Lekki, 2 → 3 nights (₦135,000 → ₦200,000), accept, then the new 3-night draft.
