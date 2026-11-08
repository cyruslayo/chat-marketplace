# 16 · Landing page: say that stays run from a few nights to 6 months

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 8 Nov 2026

## Why

Issue 13 item 4 kept the page to 1–14-night stays "until counsel signs off". Counsel approved ADR 0092 on 1 Nov 2026 and Extended Stays (30 to 180 nights, 1 to 6 months) are on in every deployment. The owner approved the monthly positioning and the copy below on 8 Nov 2026 (recommendations from the landing copy assessment).

## Approved copy (use exactly; all within the slot limits in `LANDING_LENGTH_LIMITS`)

| Slot (`LANDING_COPY`) | New text |
|---|---|
| `heroEyebrow` | Furnished apartments · by the night or month |
| `heroLede` | Say what you need, for a few nights or a few months. See only what you can book, at the full price. Your money stays yours until it’s confirmed. |
| `composerPlaceholder` | Where, for how long, and who’s coming? |
| `exampleChips[2]` (replaces "Ikoyi, 2 weeks from 10 Sept") | Ikoyi, 60 nights from 5 Jan, relocating (nights: 60) |
| `howEyebrow` | How it works · one stay, five screens |
| `closingHeading` | Start with the stay, not the form. |
| `pageTitle` | Shortlet · Lagos and Abuja apartments, nights or months |
| `moneyCards[2].body` | Once payment is verified, the Reservation is confirmed. Staying a month or more? You pay 30 nights at a time, each on its own due date. |
| New FAQ entry, after "And if the Operator says no?" | Q: Can I stay for a month or longer? A: Yes, from 30 nights up to 6 months, in apartments that offer it. You pay the first 30 nights to confirm, then each later 30 nights by its own due date. |

**New band "Staying for months?"** placed after the money section, built only from existing kit components and semantic tokens (AGENTS.md "Guest UI work"; no new component, no hex, no `style:` strings):
- H2: "Staying for months? *Pay one month at a time.*" (the second sentence is the italic accent, like the other headings)
- Line: "Not a hotel bill for three months. Not a year paid upfront before you know the city."
- Three facts: "One monthly price, all-in." · "Each apartment lists what’s included: power, water, internet, cleaning." · "30 nights at a time, never more than one period ahead."
Add length limits for the new slots (H2 55, line 130, fact 70) and test them like the others.

## Rules

- **Chip validator.** `validateExampleChips` must accept any Short Stay (1–`MAX_STAY_NIGHTS`) or Extended Stay length (the policy's 30–180), and refuse 0 and 181+, with a message naming both ranges. Import from the domain index only.
- **Chip must work end to end.** The concierge reads "60 nights" but has no month parser, which is why the chip says nights. Add a test that sending the chip text from the landing handoff (issue 14 path) on a production-like composition yields a 60-night search, not a nights clarification. Do not add a month or keyword parser (ADR 0106).
- **Forbidden terms.** Add `rent`, `lease`, `tenant`, `tenancy` and `landlord` to `LANDING_FORBIDDEN_TERMS` (ADR 0092 guest wording), as whole words. "upfront" is fine.
- **Do not change** other slots, the trust strip, the beats, the approved FAQ answers, or the demo notice. The phone and chat mock screens are not marketing copy (ADR 0077).
- Record in landing issue 13 Comments that item 4 is superseded by this issue.

## Acceptance criteria

- AC1: Every slot in the table renders exactly the approved text, within its length limit.
- AC2: The "Staying for months?" band renders its H2, line and three facts using kit components only, and passes the foundation/retired-class tests.
- AC3: The chip validator accepts 29, 30, 60 and 180 nights and refuses 0 and 181.
- AC4: The 60-night chip, sent through the landing handoff, produces a 60-night search on a production-like composition.
- AC5: No landing copy contains a forbidden term, including the five new ones.
- AC6: ADR 0078 checks pass (no horizontal overflow, 44px targets, light and dark); captures at 320, 390, 768 and 1280 under `screenshots/16/`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 (amended) | 30–180-night Extended Stays; no tenancy wording |
| 0023 (amended) | 1–29-night Short Stays |
| 0077 | One source for guest wording |
| 0078 | Accessible launch profile |
| 0106 | No keyword shortcuts around the model |

## Definition of Done

See `docs/agents/issue-tracker.md` and AGENTS.md "Guest UI work". Record commands and pass counts in Comments.

## Comments
