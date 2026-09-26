# Discovery fit reasons and contextual quick replies

Status: resolved
Type: task
Blocked by: 03b
Findings: F11 (see ../PRD.md)

## What to build

Add up to three fit reasons per card, computed from unit data against the criteria ("sleeps 2 exactly", "backup power"). Suggest quick replies that match the missing criterion or common refinements. Make the result card full width. Show the "indicative rates" footnote only when dates are missing.

## Acceptance criteria

- AC1: Every fit reason can be traced to a unit field. Units without data show no reason.
- AC2: The footnote is absent when dates and party size are known.
- AC3: After a clarify reply, the quick replies match the missing criterion.
- AC4: The card fills the transcript column width.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0015 | All-in price on every card |
| 0066 | Specific trust claims only |
| 0008 / 0009 | Inspection evidence wording |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Fit reasons (AC1).** `fitReasons(unit, filters)` in `discovery-a2ui.ts` returns up to three reasons. Each names its `source` field:
  - `capacity` against the party: "Sleeps 2 exactly" or "Room for 2 (sleeps 4)";
  - `bedrooms` against the requested count: "2 bedrooms, as asked";
  - `amenities`: backup power, labelled by `guestAmenityLabel`;
  - `trust.inspection`: "Physically inspected 15 Jan 2026". This is a dated, specific claim (ADR-0008, ADR-0066) and appears only when the inspection is current or passed.
  - Nothing is inferred. A unit without the field, a party larger than the capacity, or a different bedroom count gives no reason. With no reasons there is no line.
  - Cards show one caption, "Why it fits: …". The client finds it by that prefix rather than by position.
- **Footnote (AC2).** `browse.ts` adds `INDICATIVE_RATES_DISCLOSURE` only when dates or party size are unknown (ADR-0015 all-in pricing). Dated searches with a party size carry no footnote.
- **Quick replies (AC3).**
  - Clarify resolutions now carry `next` (where, who, when or nights).
  - `quickRepliesFor(next)` in `concierge.ts` returns phrases the interpreter already parses: the neighbourhood areas from `SEARCH_AREAS`; "Just me" and 2–4 guests; "This weekend", "Next weekend" and "Next Friday" (these still go through date confirmation); and 1, 2, 3 or 7 nights.
  - `quickReplies` rides on clarify results, from typed turns and from strip edits.
  - The client shows them as a `role="group"` of chips. Tapping one sends it as the Guest's message, and the chips are removed on any new message.
- **Card width (AC4).** The two-column grid at 48rem and above is gone, and the Weaver Card's default 8px margin is zeroed, so each card fills the results column.
- **Fixed on the way (S10a/S10b).** Below 30rem the chip field names are visually hidden, so empty chips all read "Add". They now read "Add area", "Add dates", "Add guests" and "Add budget".
- **Tests.**
  - `test/guest-discovery-reasons.test.ts`: AC1–AC3. Each reason is re-derived from its field. Failure paths: no data gives no reason; dates without a party still show the footnote; every quick reply, sent in a fresh thread, answers the question it was offered for; search results and refusals offer none.
  - `test/guest-discovery-reasons-chromium.test.ts`: AC4 at 375px and 1280px, plus a quick-reply tap and the empty-chip label.
- Verification: `npm run check` passed. `npm test`: 1,144 passed, 0 failed, 1 skipped. The guest browser tests (51) were rerun on the final client build and pass. Walkthrough at 375px: fit lines on both Lagos cards, no footnote, and the quick-reply and empty-chip labels as expected.
