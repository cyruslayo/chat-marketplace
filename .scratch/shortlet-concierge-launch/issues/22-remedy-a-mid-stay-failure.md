# Classify and remedy a Mid-Stay Failure

Status: resolved
Type: AFK
User stories: 52–53

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Open a Mid-Stay Failure, classify safety/access/habitability, essential amenity, material advertised amenity, or minor impact, track the applicable cure window, and calculate the accepted per-night remedy from verified severity, duration, impact, and cure.

## Acceptance criteria

- [x] Category and timing boundaries produce the exact accepted 100%, 50%, 25%, 20%, 10%, or no-automatic-payment outcomes.
- [x] Refunds use each affected contracted nightly line item and attributable undelivered charges and taxes.
- [x] Material incidents hold exposed revenue and preserve consent, evidence, causation, and human authority.
- [x] Delayed reporting is handled fairly where safety or practical circumstances prevented immediate notice.

## Blocked by

- [Issue 16](16-verify-access-with-live-support.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)

## Answer

Mid-Stay Failure now requires an active verified stay and fail-closed Primary Guest/tenant authority. Evidence, classification, timing, impact, causation, cure, and delayed-report treatment come from trusted provider/server state. Exact ADR 0061 boundaries are enforced, using current contracted per-night economics and authoritative attributable undelivered charges/tax. Material incidents block Revenue Release through `BlockingComplaintQuery`; existing Human Handoff owns safety/material review, and final remedy decisions require authorized human support. Issue 23 relocation/refund choice is deliberately not implemented. Conventional and Weaver surfaces share a minimized canonical projection. Local validation: 395 passed, 0 failed, 0 skipped, 0 todo (delta +2 from 393).
