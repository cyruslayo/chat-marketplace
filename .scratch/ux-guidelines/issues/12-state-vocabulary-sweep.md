# 12 · Remaining state vocabulary findings

Status: ready-for-agent
Type: task
Blocked by: none (05 resolved 12 Nov 2026)
Phase: 1 (Batch A)
Applicable ADRs: guideline §9, §10 booking state hierarchy

## What to build

Fix the label and state-wording findings that issue 05 assigns here, for example draft, sent, offer, payment required, processing and confirmed being told apart on every channel. Issue 05 confirms the scope and writes the exact list into Comments before this becomes ready-for-agent.

## Acceptance criteria

1. Every matrix row assigned to 12 is fixed or re-assigned, with its evidence
2. Chat and standard routes show the same state label for each booking state

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments

### Decision from issue 05 (12 Nov 2026): re-scope

Reason: the evidence confirms label and wording defects but no booking-state confusion, so the scope is the label and wording list, not the state model. Matrix rows now covered (`.scratch/ux-guidelines/evidence-matrix.md`):

- Row 2: shell page title "Shortlet Concierge" (P3, from 02#1).
- Row 8: assistant "1 eligible place in Lagos" against the criteria "Old Ikoyi" (P3, from 01#7).
- Row 14: composer placeholder "Area, dates, guests" (P3, from 02#9).
- Row 16: View control accessible name repeats the verb (P3, from 04#5).
- Row 21: offline scripted reply "has been disclosed", a forbidden term (P3, from 02#38; contradicts 06 for that path).
- Row 30: photo alt text doubles the place, "in Old Ikoyi in Old Ikoyi" (P3, from 04#7).
- Row 33: redundant "Bedrooms: 2 bedrooms" and "Sleeps: Sleeps 4" (P3, from 02#37).
- Row 35: draft text "Send your request" above the button "Review request" (P3, from 04#9).
- Row 39: announcer "Your booking details is ready." (P3, from 04#11).
- Row 50: expired-offer command labels differ between chat ("Return to booking offer") and standard ("Back to your conversation") (P3, from 01#30). This is the only chat-versus-standard label mismatch for a booking state, so it answers acceptance criterion 2.
- Row 70: raw booking reference "res_cmd_..." on the confirmed screen (P2, from 01#23, 01#32, 04#18; contradicts 06, which records raw IDs as removed).
- Row 96: double step numbering "1 1", unverified, code only (P3, from 02#24).

Not in this issue: the Amount Due Now wording (owner decision of 12 Nov 2026, no action), the money line wraps (rows 23, 24, 25 and 73 go to the reflow group), and the state-model items, which had no defect rows.

Acceptance criteria are unchanged. Status unchanged.
