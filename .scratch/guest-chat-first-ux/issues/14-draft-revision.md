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

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/14-draft-revision.md` (repo root). A turn that changes nights, dates or party size at the draft stage shows a re-quoted replacement and changes nothing. "Use the new details" (`DRAFT_REPLACEMENT_ACCEPT_EVENT`, exact `{ draftId, basedOn }`) creates the new draft. A price change re-proposes, and "Keep my current draft" changes nothing. After submission, ADR-0060 still applies.
  - Evidence: test/guest-draft-revision.test.ts (AC3 and failure paths). Code: apps/local-guest/src/guest-server.ts (`#proposeDraftReplacement`); apps/web-agent/src/draft-replacement-a2ui.ts (`draftReplacementToA2UI`). Landing: PR #67, commits 7ef11ef, 86cca90.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
