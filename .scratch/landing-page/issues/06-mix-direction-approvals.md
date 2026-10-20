# 06 · Owner approvals for the "A + C · Lagos, in conversation" direction

Status: ready-for-human
Type: grilling
Blocked by: none

## What to decide

The owner chose the mixed direction on 13 Oct 2026 (canvas <https://claude.ai/artifact/5ENjonAtFM3UMzBnvzGLrL>, boards `Mix-Desktop` and `Mix-Phone`; spec `docs/design/shortlet-landing-page-direction.md`). Before issues 07–10 can ship to the public page, the owner needs to approve the following. Each answer goes under `## Answer` with the date.

1. **Logomark and wordmark.** The house-shaped speech bubble with a keyhole, plus "Shortlet" in Newsreader. Approve, change or replace.
2. **Typefaces.** Newsreader (display) and Hanken Grotesk (body), self-hosted.
3. **New copy slots.** These are not in the approved deck (`../copy/final-copy-deck.md`):
   - hero H1: "Your apartment in Lagos or Abuja, *settled* in one conversation." (the italic word is part of the design);
   - hero lede: "Say what you need. See only what you can book, at the full price. Your money stays yours until the apartment is confirmed for your dates.";
   - trust strip:
     - "The Operator confirms first / A verified company manages each apartment."
     - "Priced all-in for your dates / Any deposit sits on its own line."
     - "Dates held while they reply / Up to 30 minutes in active hours."
     - "Pay only after the yes / If they decline, nothing is due."
   - apartments heading and line: "Apartments you can actually book, *not listings.*" / "Fewer results, by design: only apartments you can request for your dates, each one managed by a verified Operator.";
   - money timeline: its H2 and three cards, as on the board;
   - nav labels: "How it works", "Your money", "Questions", "Start a conversation".
4. **Status tags.** Issue 05's approved addition 1 put "Nothing due yet" / "Due now" under every beat. The new design shows them once, in the money timeline. Confirm that change.
5. **Photography.** Hero, closing, and one photo per city card (one must be Abuja), each of a published Unit, at least 2400px wide. State the public inspection disclosure for each (ADR-0008). Until then the Unsplash placeholders in `apps/local-guest/assets/landing/` stay on local builds only.
6. **Example chips.** For example "Somewhere quiet in Abuja for a week", "Lekki, 3 nights from Friday, 4 of us", "Ikoyi, 2 weeks from 10 Sept". All must be 14 nights or fewer (ADR-0023).

Still open from the earlier direction, unchanged: example Unit and prices, the handoff seam, support/privacy/terms links, and monthly positioning (direction doc, "Human decisions" 5–8).

## Answer

**14 Oct 2026, owner:**
- Item 1, logomark and wordmark: approved as drawn on the `Mix-Desktop` board.
- Item 2, typefaces: Newsreader and Hanken Grotesk, self-hosted, approved.

**14 Oct 2026, owner (second answer):**
- Item 3, new copy slots: approved exactly as listed above. The money timeline copy is the text on the `Mix-Desktop` board. The nav labels are approved.
- Item 4, status tags: approved. "Nothing due yet" / "Due now" move from every beat into the money timeline, which replaces issue 05's addition 1.
- Item 6, example chips: approved: "Somewhere quiet in Abuja for a week", "Lekki, 3 nights from Friday, 4 of us", "Ikoyi, 2 weeks from 10 Sept".

Item 5 (photography) is still open; the status stays `ready-for-human`. Placeholder photos may be used on local builds only.

**14 Oct 2026, owner (third answer):** Footer labels are approved: "Cities", "Shortlet", "© 2026 Shortlet", and "Help", "Support", "Privacy", "Terms" for when those links are configured.

## Comments
