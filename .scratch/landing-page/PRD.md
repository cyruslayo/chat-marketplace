# PRD: Public landing page (direction G, autoplay + scroll beats)

Status: ready-for-agent
Requested: 11 Oct 2026. Design approved by the user: 11 Oct 2026.

> **Redesign, 13 Oct 2026.** The visual design below (direction G) is superseded by "A + C · Lagos, in conversation". See `docs/design/shortlet-landing-page-direction.md`, `design-audit.md` and issues 06–10. The route, the no-JavaScript requirement, the stage contract and the copy rules in this PRD still apply.

## Problem

Shortlet has no public landing page. `GET /` on the local guest server opens straight into the
session-gated concierge. A first-time visitor never learns what the product does or why it beats
the alternatives.

## Goal

A public, mobile-first landing page at `GET /welcome` that shows, without the visitor clicking
anything, how one conversation finds an apartment, prices it in full, waits for the Operator and
confirms the stay. It is built from the guest UI kit so it looks exactly like the app.

## Design (source of truth)

Approved canvas: https://claude.ai/artifact/Njm8ocV3eAPNPYSRKTu5uu (page "Chat-first", boards
"G · One conversation (chosen)"). Local copies of the two boards and the kit stylesheet they use:

- Desktop: `C:\Users\Cyrus\AppData\Local\Temp\claude\C--AI2026-chat-marketplace\20b506e8-1af3-4ff7-a5a8-81ff228e3caf\scratchpad\landing\project\OneConversation.dc.html`
- Phone: `…\scratchpad\landing\project\OneConversationMobile.dc.html`
- Kit classes they use: `…\scratchpad\landing\project\kit.css` (a copy of `.scratch/guest-ui-consistency/design/kit.css`)

The `.dc.html` files are design comps: HTML markup plus a `DCLogic` script and `{{holes}}`. Use them
for **structure, copy, order and timings only**. Do not copy their inline `style="…"` strings, hex
values, `{{…}}` holes or `<sc-if>`/`<sc-for>` tags into the repo.

Read also: `docs/design/shortlet-landing-page-direction.md` (chat-first rules, copy constraints,
accessibility), `docs/design/shortlet-design-system-direction.md`, ADR-0078.

## What the page contains (both widths, one HTML document)

1. **App bar:** wordmark "Shortlet"; "How it works" link (`#how`); primary "Start your search" (→ `/`).
2. **Hero:** eyebrow "Furnished apartments · Lagos and Abuja"; H1 "Tell us your trip. Get apartments
   you can actually book, with the full price."; supporting line; a composer-styled call to action;
   hint "Starting a search doesn't reserve or charge anything."; a phone preview (rail, concierge
   greeting, the guest message, chips Lagos / 10–13 Sept / 2 guests, two priced result rows with
   photos, and a message box).
3. **"How it works · an example booking"** intro, then **five beats**, each: step eyebrow, "Instead of
   ~~pain~~" line, H3 fix, one paragraph, and that beat's app screen. The exact copy is in the
   desktop board:
   1. Search — message + chips + concierge reply
   2. Stay — two result rows (photo, title, ₦370,000 / ₦200,000 all-in · 3 nights) with deposit lines
   3. Request — "Draft created", photo strip, stay ticket (10 → 13 Sept), "Not sent yet",
      "Send Booking Request", "We re-check price and availability when you send"
   4. Confirmation — "Booking Request sent", waiting message, "The Operator is reviewing",
      banner "Reply due by 10:45 am WAT, 3 Sept 2026" / "Your dates are held while the Operator
      replies, within 30 minutes during their active hours." (ADR-0041)
   5. Pay and confirmed — "Your offer is ready", breakdown (All-In Stay Total ₦370,000; Refundable
      Security Deposit (separate) ₦20,000; Total to complete booking ₦390,000), "Payment verified",
      "Reservation confirmed" banner with photo; then a "Start your search" button
4. **"Good to know"**: six Q&A cards (copy in the desktop board; two answers stay as visible
   bracketed placeholders `[AREAS WITH PUBLISHED INVENTORY]` and `[APPROVED FEE ANSWER]`).
5. **Closing call to action** "Where are you headed?" plus the composer-styled CTA, then the footer.

Example content is labelled ("Example booking · real app screens"). Prices and units are the
walkthrough test data and are placeholders until the user approves real values.

## Behaviour

- **No JavaScript:** the page is complete. Every beat screen is rendered in its **final** state.
- **With JavaScript and motion allowed:** see issue 02 (hero typing → send → bubble; each beat plays
  once when it scrolls into view, every sequence under 5 s, so no pause control is needed under WCAG
  2.2.2; desktop ≥ 64rem with a scrolling page pins one phone beside the captions and swaps screens).
- `prefers-reduced-motion: reduce` → no motion at all, final states shown.
- The CTAs are links to `/`. **No message text is carried into the app yet**: the
  landing-to-thread handoff is an open human decision (landing direction doc, decision 3). The
  composer-styled CTA is therefore a link that looks like a message box, not a form that sends text.

## Constraints

- Use the kit, don't invent components (AGENTS.md "Guest UI work"). Reuse `apps/local-guest/src/guest-kit.ts`
  helpers where their output matches a beat element (for example `ticketHtml`, `breakdownHtml`,
  `statusHtml`, `resultRowPartsHtml`), and the vocabulary in `apps/web-agent/src/guest-content.ts`
  (`GUEST_GLOSSARY`, `GUEST_FACT_LABELS`, `GUEST_RECEIPTS`, `GUEST_JOURNEY`) where a string exists.
- Semantic tokens only; no hex; no page-level `style=` strings. Landing-only CSS lives in a new
  `apps/web/src/shortlet-landing.css`. **Do not edit or reformat `shortlet-foundations.css`.**
- No Weaver runtime on the page. No external requests: no fonts, CDNs or analytics.
- 44px targets, 320px reflow without horizontal scroll, one H1, skip link, semantic landmarks
  (ADR-0078). Light and dark from the foundation tokens.
- Photos are temporary Unsplash placeholders (the user will replace them), stored in the repo.

## Out of scope

Pilot server wiring, a real landing-to-thread handoff, analytics, Monthly Stay copy, real inventory feed.
