# Keep Extended Stays off in production until counsel's text is recorded

Status: ready-for-agent
Type: AFK
Blocked by: 02 (decision 1)
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), decision D1.

## Why

ADR 0092 (amended 1 Nov 2026) says: items marked **[counsel text]** (the lawful process for an unpaid period, the licence-to-occupy wording and the receipt fields) "must not ship guest-facing behaviour that depends on them until counsel's text is recorded in `.scratch/monthly-stays/issues/02`". Issue 02's `## Answer` lists all three as "Still to record". Commit c32ed3a turned Extended Stays on in every deployment, so production would offer a contract and receipts with no approved wording.

## What to build

- A fail-closed production switch for Extended Stays (for example `SHORTLET_EXTENDED_STAYS`, enabled only when exactly `"enabled"`), read the same way `COMMERCE_ENABLED` is (`packages/commerce-switch`).
- Production with the switch off: discovery, the concierge, the assistant planner and the chip validator refuse 30+ nights with the existing closed refusal for an unoffered stay length if one exists; if none does, ask the owner for the copy rather than inventing it, and Short Stays (1-29) are unchanged.
- Staging and the ADR 0105 demo keep Extended Stays on.
- Turning the switch on in production is refused at startup unless a recorded marker says counsel's text is in (keep it simple: the owner flips it after issue 13 resolves; document that in `docs/pilot-deployment.md`).

## Acceptance criteria

- [ ] AC1: Production with the switch off refuses a 30-night search, request and quote; the assistant path returns a `tool_denial`, never a thrown error (ADR 0106).
- [ ] AC2: Production with the switch off still books a 29-night Short Stay.
- [ ] AC3: Staging and the demo still book a 30- to 180-night Extended Stay.
- [ ] AC4 failure path: any value other than exactly `"enabled"` keeps Extended Stays off.
- [ ] AC5: Assistant enabled, cold restore before every event, staging-like clock and guest.

## ADRs to read

0023 (amended), 0092 (amended), 0104 (fail-closed switch pattern), 0105, 0106.

## Comments
