# 35 · Focus and announcements after each workspace change (reopens 14)

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 2 (follow-up from Phase 0; owner approved 12 Nov 2026)
Applicable ADRs: 0078 (accessibility), 0106 (assistant path, cold restore); guideline §12, §14 required proof

## What to build

Matrix rows 52, 53 and 15. Issue 14 moved focus for the first workspace only; the live staging journey (`evidence/04-rows.md`) found the rest.

- **Focus (row 53):** after each workspace change, move focus to the new screen's heading. On a form screen (phone, email), move it to the first field. Today it lands on "Back to conversation" on unit detail, draft, contact, offer, payment and confirmed.
- **Announcements (row 52):** announce each new screen once, including the offer and payment screens. Today the announcer keeps the previous text ("Your booking details is ready."). Fix that line's grammar too.
- **Task-naming H1 (row 15):** while browsing results, the page H1 says "Booking details". Give each workspace kind an H1 that names the task (for example "Stays to explore", "Stay details", "Your booking details", "Booking offer").
- Keep issue 14's rule: a turn's assistant message is announced by the transcript, so no double announcements.

## Acceptance criteria

1. After each workspace change, focus is on the new screen's heading, or on the first field for a form screen
2. The offer, payment and confirmed screens are each announced once, and no screen is announced twice
3. Each workspace kind has an H1 that names its task
4. A real-Chrome test drives search to payment with the assistant runtime enabled and a cold restore before every event (ADR 0106), asserting focus and the announcer text at each step

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- `client.ts` changes run one at a time: not in parallel with 36 or 37.
- Use the kit and `guest-content.ts` for copy. No new components and no `any` in domain types.
- Regenerate and commit `apps/local-guest/dist/client.js` with the source change.
- Test scope: `npm run check` plus this issue's own and affected tests, and the real-Chrome files for the changed screens, one at a time. Record the exact commands and pass counts here.
- Commit by explicit path only. Never stage `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments
