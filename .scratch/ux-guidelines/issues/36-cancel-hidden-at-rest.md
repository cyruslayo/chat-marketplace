# 36 · Keep Cancel hidden until a turn is slow (reopens 21)

Status: ready-for-agent
Type: bug
Blocked by: none
Phase: 3 (follow-up from Phase 0; owner approved 12 Nov 2026)
Applicable ADRs: 0078; guideline §6 turn behaviour, §8 controls

## What to build

Matrix row 5. On staging, a "Cancel" button shows under the message box when no turn is running. `#turn-cancel` carries the `hidden` attribute, but `.ui-button { display: flex }` in `shortlet-foundations.css` overrides it.

- Make `[hidden]` win for kit buttons. Prefer one rule in the kit block (for example `.ui-button[hidden] { display: none; }`) over a one-off. Check the other kit components that set `display` for the same problem, and list them in Comments.
- Cancel appears only after the still-working threshold (`TURN_STILL_WORKING_AFTER_MS`) and hides again when the turn ends.

## Acceptance criteria

1. With no turn running, Cancel is not rendered (computed `display: none`) and is not in the accessibility tree
2. Cancel appears after the still-working threshold and disappears when the turn ends, is cancelled or fails
3. Any other kit component with the same `hidden` override is fixed or listed with the reason it is safe

## Rules

- Follow the AGENTS.md implementation protocol. Write one named test per acceptance criterion, covering its failure paths. Extend `test/guest-turn-cancel-chromium.test.ts` for AC1 and AC2.
- Foundation CSS: commit `shortlet-foundations.css` before running `test/landing-page.test.ts`. Keep literal six-digit hex tokens and the committed formatting; do not run a formatter over it.
- `client.ts` changes, if any, run one at a time: not in parallel with 35 or 37.
- Test scope: `npm run check` plus this issue's own and affected tests (`guest-kit`, `shortlet-design-system`, `landing-page`, and the cancel Chrome test). Record the exact commands and pass counts here.
- Commit by explicit path only. No stash, reset or clean.

## Comments
