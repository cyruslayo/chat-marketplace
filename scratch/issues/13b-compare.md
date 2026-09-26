# Two-up comparison from results

Status: resolved
Type: task
Blocked by: 11, 09
Parent: [13](13-thread-control.md)

## What to build

Let the guest pick two results and open a comparison of the All-In Stay Total, capacity and amenities, stacked vertically at narrow widths. Build it from Basic Catalog components in `discovery-a2ui.ts`.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC2: Choosing Compare on two results shows price, capacity and amenities aligned.
- AC3: At 320px, the comparison stacks attributes vertically with no horizontal scroll.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0078 | Comparison stacks vertically at narrow widths |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Picking (AC2).** With two or more results, each card has a Compare button after View apartment (`COMPARE_UNIT_EVENT`, context `{ artifactId, unitId }`).
  - The first pick re-presents the same results surface with that card reading "Remove from compare", and says "Choose one more stay to compare with {title}."
  - The same card again un-picks it.
  - A second card opens the comparison.
  - The pick is `thread.compareSelection`: in memory, never persisted, and cleared by any new search (`#prepareDiscovery`).
  - Presentation only; no domain command runs (ADR-0072).
- **Comparison (AC2).** `compareArtifactToA2UI` in `discovery-a2ui.ts` uses Basic Catalog components only (ADR-0073, ADR-0081).
  - It has one `Row` per attribute from `COMPARE_ATTRIBUTES`, in fixed order: All-In Stay Total (ADR-0015); Refundable Security Deposit on its own row, "paid separately" (ADR-0016); capacity with bedrooms and bathrooms; and the full amenity list.
  - Each cell repeats its stay's title, so a stacked cell still says what it describes.
  - The surface is `thread-…:compare:{revision}` (focused) and supersedes the results. "Back to results" (`COMPARE_BACK_EVENT`) re-presents the same stored artifact without a new search.
  - After a restart, a comparison is restored as its results.
  - `compareFallbackText` is the text fallback.
- **Stacking (AC3, ADR-0078).** The client adds `.compare-row` and `.compare-cell`. Rows are a two-column grid, and one column below 30rem, with `overflow-wrap: anywhere`. At 1280px the comparison sits in the split workspace, side by side.
- **Fails closed.** A tampered `artifactId`, a stay not in the results, extra or missing context keys, or a single-result search gives `INVALID_CONTEXT` or no control. The old results surface is stale once the comparison opens.
- **Note:** Weaver doesn't render `accessibility.label` as `aria-label`. Card buttons take their context from the listed card, the same as View apartment.
- **Tests.**
  - `test/guest-compare.test.ts`: AC2 (the attribute order, each cell's value against the artifact, the back link), plus failure paths: un-pick, tampered or unknown context, a stale surface, a new search clearing the pick, a single result, and the presenter throwing on a missing stay.
  - `test/guest-compare-chromium.test.ts`: AC3 at 320px (cells share a left edge and stack, with no horizontal scroll), plus 1280px (side by side) and 375px.
- Verification: `npm run check` passed. `npm test`: 1,166 passed, 0 failed, 1 skipped. Walkthrough on :3001 at 320px, 375px and 1280px.
