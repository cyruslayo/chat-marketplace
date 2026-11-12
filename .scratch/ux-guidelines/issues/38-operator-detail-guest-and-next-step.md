# 38 · Operator detail: Guest name and the after-decision next step

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 4 (follow-up from Phase 0; owner approved 12 Nov 2026)
Applicable ADRs: 0041, 0042 (Operator response), 0011 (data minimisation), 0078; guideline §3 Operator, §5 Operator detail, §9, §10 booking state

## What to build

Matrix rows 84 and 88 (`evidence/03-rows.md` rows 5 and 9).

- **Guest name (row 84):** the request detail page shows the Guest's phone but not their name, which appears only on the inbox row. Show the Primary Guest's name on the detail page, from the same projection the inbox uses. Check ADR 0011 first: if the detail page is meant to minimise Guest data, record why and ask the owner instead of adding it.
- **After a decision (row 88):** after a confirm or decline, the page says "Request confirmed" and "This request is no longer actionable", but nothing about what happens next, and the response deadline line still shows. Replace the deadline with the decision and its time in WAT. Add one line on what happens next, taken from existing guest-journey copy (after confirm, the Guest accepts the offer and pays, and it becomes a Reservation once payment is verified; after decline, nothing further is needed). Never invent policy.

## Acceptance criteria

1. The request detail page shows the Primary Guest's name, or Comments record the ADR 0011 reason it must not
2. A decided request shows its decision and decision time in WAT, and no open response deadline
3. A confirmed or declined request shows one line on what happens next, from existing copy
4. "Operator Hold" keeps its capitals, and the issue 26 labels and duplicate-decision guard are unchanged

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths. Reuse the helpers behind `test/back-office-confirm-decline.test.ts`.
- No new components; follow the existing Operator page markup. No `any` in domain types.
- UI change: captures at 320, 390, 768 and 1280, saved under `screenshots/38/`.
- Test scope: `npm run check` plus this issue's own and affected tests (`back-office-request-inbox`, `back-office-confirm-decline`, `operator-detail-clarity`). Record the exact commands and pass counts here.
- Commit by explicit path only. No stash, reset or clean.

## Comments
