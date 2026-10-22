# Show demo monthly prices and payment periods in guest screens

Status: ready-for-agent
Type: AFK
Blocked by: 09, 10, 11, 13

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Guests need to see the whole-stay amount and the six-period payment plan before they request a demo stay.

## What to build

- Use the guest UI kit and shared content helpers for chat and the standalone page.
- Show the monthly price, whole-stay All-In Stay Total, utilities and servicing facts, and each Billing Period's dates, amount and due date.
- Keep the request review consistent with the quote and booking snapshot.
- Keep the demo notice and "Demo listing" chip visible. Do not suggest real accommodation, real payments, or six calendar months.
- Use only copy already approved in `GUEST_FACT_LABELS` or the demo notices. Raise any missing policy wording before adding it.

## Acceptance criteria

- AC1: A 30-night unit card and detail page show the period amount and included utilities with the same content in chat and page views.
- AC2: A 180-night quote and request review show the all-in total and all six periods with dates, amounts and due dates.
- AC3: A unit without Monthly Agreed Amounts, utilities or servicing terms never appears as an Extended Stay result.
- AC4: The first and later period payment screens show which period is payable and the existing payment status. They never imply that future periods have been paid.
- AC5: Light and dark screenshots at 320, 390, 768 and 1280 pixels show no horizontal overflow or controls below 44 pixels.
- AC6: Chat and standalone unit detail use the same gallery, values and demo labels. Existing Short Stay screen tests pass unchanged.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0015 | One All-In Stay Total and no hidden mandatory charges | AC1–AC4 |
| 0077, 0080 | Canonical projection and deterministic payment state | AC1–AC4, AC6 |
| 0078 | 320-pixel reflow, 44-pixel controls, light and dark | AC5 |
| 0092 | Period amounts, due dates and included utilities | AC1–AC4 |
| 0105 | Public staging demo labels and illustrative photos | AC1, AC6 |

## Source issues

- [Monthly-stays issue 11](../../monthly-stays/issues/11-guest-discovery-for-monthly-stays.md)

## Definition of Done

Use the repository checklist and AGENTS.md guest UI requirements. Save captures under `.scratch/demo-launch/screenshots/12/`. Preserve all existing Short Stay tests unchanged. Run `npm run check`, the affected tests and the required capture checks. Record exact commands and counts in `## Comments`.

## Comments
