# Shortlet Public Landing Page Direction

This is a public information architecture and design specification, not a new route or implementation. Shortlet is **chat-first**: a Guest finds and books a stay by talking to the concierge, and the landing page exists to show that experience and start it. The page introduces a credible Abuja/Lagos stay service, shows one booking conversation from first message to Reservation, and hands the Guest into the same concierge thread with their first message intact. See the [UI/UX audit](shortlet-ui-ux-audit.md), the [design system](shortlet-design-system-direction.md) and the guest UI kit in `.scratch/guest-ui-consistency/`.

**Chosen direction (13 Oct 2026):** "A + C · Lagos, in conversation" on the directions canvas <https://claude.ai/artifact/5ENjonAtFM3UMzBnvzGLrL>, boards `Mix-Desktop` and `Mix-Phone`. It combines direction A's photography and editorial type with direction C's large chat window, single pinned phone and money timeline. The design audit that led to it is `.scratch/landing-page/design-audit.md`.

This supersedes the earlier "G · One conversation, start to keys" direction (canvas <https://claude.ai/artifact/Njm8ocV3eAPNPYSRKTu5uu>). G's core idea stays: the page is a conversation. What changes is everything around it: brand, type, photography, layout and section rhythm. The rules G set and this direction replaces are listed under "Superseded rules".

## Job and audience

Help someone who needs an entire-place stay in Abuja or Lagos see, before they start, how easy the concierge makes it: they describe the trip in their own words, the concierge asks only for what's missing, shows apartments they can book with the All-In Stay Total for their dates, answers follow-up questions in the same thread, and carries them through Request, Offer, payment and Reservation without leaving the conversation. Give returning Guests a clear route back into their current conversation.

Most Guests arrive on a phone. The page is designed at phone width first and widened for desktop, never the reverse.

The page sells the **experience of the conversation and the place**, not the technology. It never names Weaver, A2UI, models or "AI agents", and avoids "Ask our AI" framing, robot or avatar illustrations and chatbot clichés.

## Core idea

1. **The place.** The first viewport is a real apartment photograph with the headline and composer on it. Typing a trip there is the primary action on the page.
2. **The conversation.** A large example chat window rises out of the photograph: the Guest's message, the criteria it produced and two priced apartments. It shows the product at a size you can read, not as a thumbnail.
3. **The journey.** One phone stays pinned while the five steps scroll past it, then a timeline shows when money is and isn't due.
4. **The ending.** The composer appears again, over a second photograph.

## Two layers: brand around the app

The page has two visual layers, and the line between them is strict:

- **The app layer** is everything inside the chat window and the pinned phone. It is drawn with the guest UI kit (`ui-*` classes, `apps/local-guest/src/guest-kit.ts`) and the wording comes from `apps/web-agent/src/guest-content.ts`, so it is exactly what the app ships (ADR-0077).
- **The brand layer** is everything around it: logo, type, photography, section surfaces and layout. Its styles live in `apps/web/src/shortlet-landing.css` under landing tokens. They never leak into `shortlet-foundations.css` or the app.

When the app is restyled later, the brand layer may be adopted there, but this document does not change the app.

## Visual system

### Brand mark
A logomark beside the wordmark: a speech bubble whose top is a roof peak, with a keyhole. It stands for a conversation that gets you a home. The wordmark is "Shortlet" set in the display serif. Ship it as inline SVG (`currentColor` plus one fill), with a version for dark surfaces. The mark needs owner approval before launch.

### Type
- **Display:** Newsreader (serif with optical sizes and a true italic), weights 400 and 500, plus 400 italic. Headlines are 500; one word or phrase per headline may be set in 400 italic in the accent colour. That is the only decorative device: never more than one per headline, and never in body text.
- **Body and UI:** Hanken Grotesk, 400, 600 and 700.
- Both are SIL Open Font License. **Self-host** subset WOFF2 files with `font-display: swap` and keep the system stacks as fallback. This meets the design system's webfont rule (`shortlet-design-system-direction.md`, Typography) and ADR-0078's degraded-network target. No request goes to a third-party font host.
- At most five font files in total. Subset to Latin plus `₦` (U+20A6), typographic quotes and dashes.
- Hanken Grotesk has no `₦` glyph (checked 14 Oct 2026). Every brand-layer amount is therefore set in Newsreader, which has it, through a money token and class (`--landing-font-money`, `.landing-money`). The whole amount then renders in one font. Never set a `₦` amount in the body face. Amounts inside the app layer keep the app's own fonts.
- Scale: hero H1 clamp(46px → 84px) on desktop, 40px on a 390px phone; section H2 clamp(34px → 52px); step H3 23px, active step 32px; body 16px; lede 19–20px; eyebrow 12–13px uppercase with 0.14em letter spacing. Nothing under 12px (ADR-0078).

### Colour (landing tokens, light)
| Token | Use | Value in the comp |
| --- | --- | --- |
| `--landing-ground` | Page | #F4EFE6 |
| `--landing-paper` | Raised panels, trust strip | #FBF8F2 |
| `--landing-ink` | Text | #14231C |
| `--landing-forest` | Primary action, chat bubbles | #0B4A38 (the app's brand green) |
| `--landing-forest-deep` | Money band, footer | #0B3D2E / #072E24 |
| `--landing-accent` | Italic accent and eyebrows on dark | #E8C98A |
| `--landing-accent-ink` | Eyebrows and numerals on light | #856429 (darkened from the comp's #8A6A2F, which fails 4.5:1 on ground) |
| `--landing-scrim` | Photo overlay | rgba(7,30,23,0.62–0.66) |

- The tokens live in one marked block at the top of `shortlet-landing.css` (`landing-brand-tokens:start` … `:end`), with light, dark and system-dark sets. Colour literals are allowed only inside that block (owner decision, 14 Oct 2026); the rest of the stylesheet uses tokens.
- Dark mode redefines the same tokens. Photograph sections stay dark in both themes.
- Every text and background pair meets 4.5:1, or 3:1 at 24px and above, including text on the photo scrim. Check this at the lightest point of each photo.

### Photography
- Photography is required: one hero image, one closing image and one per city card. Use real interiors of published Units, approved by the owner, with dated inspection only where the Unit carries it (ADR-0008). No stock imagery at launch; the current Unsplash files in `apps/local-guest/assets/landing/` are placeholders.
- Text never depends on the image. A solid scrim colour paints first, so headline, composer and reassurance are readable before or without the photo (ADR-0078: text and critical facts load before nonessential media).
- Budget: the hero uses a responsive `srcset` in AVIF with a WebP fallback: about 120 KB or less at 1440 wide and 50 KB or less at 390. Other images lazy-load, and every image has fixed dimensions. Hero and closing photos are decorative (`alt=""`). City card photos describe the room.

### Layout grid
- One content container: max 1200px, side gutters clamp(16px, 4vw, 40px). The app bar, every section and the footer share the same left edge.
- Section rhythm comes from changing surfaces: photo hero → ground → paper strip → ground → deep green band → ground → photo closing → deep green footer. Vertical padding is 96–128px on desktop and 64–80px on a phone.
- No borders or shadows as decoration. The two shadows are the chat window and the pinned phone, because they float.

## Page architecture

| Order | Section | Content and interaction | Rules |
| --- | --- | --- | --- |
| 1 | App bar | Mark and wordmark left. Links: "How it works", "Your money", "Questions" (in-page anchors). Right: a 44px round theme icon button with an accessible name, and one filled "Start a conversation" button. "Continue your conversation" replaces the primary action only when session state exists. | Sits on the hero photo in cream and becomes solid ground with a hairline once scrolled (sticky). At 320–390px: mark and wordmark, theme icon, "Start". No hamburger of unimplemented destinations. Skip link targets main. No Operator link. |
| 2 | Hero | Full-bleed photo with scrim. Centred: eyebrow, H1 with one italic word, a one-sentence lede, the composer (visible label "Describe your stay", placeholder, "See what you can book"), two or three example chips, and the reassurance line. | Headline, composer and reassurance fit the first viewport at 360×640 and 390×800, and the composer fits at 320×568. Chips fill the field and never auto-send. Every example chip describes a stay of 14 nights or fewer (ADR-0023). |
| 3 | Example conversation window | A wide kit-drawn chat window overlapping the bottom of the hero. Left: greeting, the Guest's message, criteria chips, the concierge reply and the composer. Right: two result cards with photo, area, title, All-In Stay Total for the nights, and the deposit line. Journey chips across the top. Labelled "Example booking · real app screens". | App layer only. Prices are All-In Stay Totals (ADR-0015), with any deposit on its own line (ADR-0016). Phone: the window becomes a card peeking up from the bottom of the first viewport. |
| 4 | Trust strip | Four facts in one ruled row: the Operator confirms first; priced all-in for your dates; dates held while they reply; pay only after the yes. Each has one short supporting line. | Process facts only, all traceable to ADR-0005, 0015, 0016 and 0041. No ratings, volumes, testimonials, partner logos or guarantees. Wraps to two columns, then one. |
| 5 | Apartments | H2 "Apartments you can actually book, *not listings.*", one supporting line, then three photo cards (area, bedrooms, city). | Cards show real published Units only. A missing Abuja Unit shows a labelled placeholder, never stock. Cards link to discovery through existing capabilities; no price is shown without dates (ADR-0015). |
| 6 | How it works | Eyebrow and H2 "Five screens you'll see. *Five hassles you won't.*" A vertical progress line with the five steps (Search, Stay, Request, Confirmation, Pay and confirmed). The active step expands to its heading, body and an "Instead of …" line in plain text. One pinned phone beside it shows that step's app screen. | Desktop: the phone pins and swaps screens as each step becomes active; steps that aren't active are dimmed. Phone, and whenever motion is reduced: each step is followed by its own screen, all expanded. No strikethrough and no warning icon on the "Instead of" lines. The sequence matches ADR-0005, 0041 and 0044. |
| 7 | Your money | Deep green band. H2 "Your money stays yours until the apartment is *confirmed for your dates.*" A three-card timeline: request sent (Nothing due yet), Operator says yes (Nothing due yet), pay and confirmed (Due now: the amount on your offer). | This is the one place the "Nothing due yet" and "Due now" tags appear; they no longer repeat under every step. Status is never shown by colour alone. |
| 8 | Questions | Two columns: H2 left, native `<details>` list right, first item open. Only answers that are approved ship; a question whose answer is a placeholder is left out until approved. | Answers are readable without chat. Each summary is at least 44px tall. |
| 9 | Closing | Second photo with scrim. H2 "Start with the trip, *not the form.*", the composer again, and "Starting a conversation doesn't reserve or charge anything." | Same behaviour as the hero composer. |
| 10 | Footer | Deep green. Mark, wordmark and one line; columns for Cities (Lagos, Abuja), Shortlet (anchors) and Help (support, privacy, terms); © line. | Support, privacy and terms links appear only once they exist; until then the Help column is left out. No bracketed placeholders on the public page. 44px targets. |

City pages, a search form, a featured-inventory grid with prices and a separate diagram are **not** part of this page.

## Phone layout

The phone layout is the reference; desktop has the same order with more room.

| Width | Layout |
| --- | --- |
| 320–390px | One column, 16px gutters. Hero photo behind the app bar and headline. The composer's send button is a 48px icon button with the accessible name "See what you can book". Chips sit in one row and can scroll horizontally inside their own row; the page never scrolls sideways. The chat window peeks up from the bottom of the first viewport. Trust strip one column; apartment cards stacked; steps each followed by their own screen; money timeline stacked. |
| ~768px | One column with wider measure; trust strip two columns; apartment cards two columns. |
| 64rem+ | Centred hero; the chat window is two panes (conversation, results); a 4-column trust strip; 3 apartment cards; steps on the left with the pinned phone on the right; 3-column money timeline; two-column FAQ. |

- No horizontal page scrolling at 320px or at 200% zoom (ADR-0078).
- Every tappable element is at least 44×44px; the composer field and send button are at least 48px tall.
- Phone screens are drawn at real phone size, not as shrunken desktop screenshots.

## Motion

- On load, the chat window plays the hero sequence once: the Guest's message, the criteria chips, typing, then results. The stage contract (`data-landing-*` attributes) stays as it is.
- On desktop, the pinned phone changes screens as each step reaches the middle of the viewport, reusing the existing beat sequences.
- Under `prefers-reduced-motion`, or without JavaScript, everything shows in its final state and each step keeps its own screen. Nothing loops or types itself out after the first play, and nothing animates the money timeline.

## Superseded rules from direction G

| Rule in G | Replaced by |
| --- | --- |
| "No hero photo is required" | Photography is required, but text never depends on it (Photography). |
| "Never a separate marketing look" | The two-layer rule: kit inside the app frames, brand layer around them. |
| "No remote fonts" | Self-hosted subset webfonts; still no third-party font request. |
| "No gradients, glass, glow … beyond a simple rounded border" | The ban on gradients, glass and glow stays. The chat window and pinned phone may each carry one soft shadow, and photo sections use a flat scrim. |
| Six phone frames, one per beat | One pinned phone on desktop; one screen per step on a phone. |
| Status tags under every beat (issue 05, addition 1) | Shown once, in the money timeline. This changes an owner-approved addition and needs the owner's confirmation (issue 06). |
| Struck-through "Instead of" lines with a warning icon | Plain text, on the active or expanded step only. |

## Landing-to-concierge handoff

### Preferred interaction

The hero and closing composers accept free text. On send, the Guest moves straight into a new concierge conversation where that text is the **first Guest message**, already shown in the transcript, and the concierge responds as it would to any first message: it extracts what it can into criteria chips, asks the next missing question, or returns results. The entry point is conceptually `first message → concierge thread → useful results`; the Guest never lands in an empty composer or has to retype.

### Context continuity rules

- Show the Guest's message in the transcript immediately while the concierge initializes and responds.
- Carry only what the Guest typed. Don't invent default dates, guests or budget; the concierge asks for what's missing.
- Sending is a read/discovery action. It does not create a Draft, Booking Request, Operator hold, Reservation or payment attempt.
- If the concierge fails to respond, keep the message and offer retry; nothing typed is lost.
- If the Guest already has an active conversation or committed work, offer "Continue your conversation" first. Starting a new one follows `GUEST_NEW_CONVERSATION` and never withdraws existing work (ADR-0079).
- Never put the message text in a public URL or query string: Guests type names, phone numbers and dates into free text. Pass it through the application's own state or request body only after the boundary is reviewed.

This is an experience target only. Until the seam is approved the composers link to the app without carrying text, as they do today. A later implementation must confirm the route/application seam with domain owners and keep ADR-0080 deterministic parity for the critical workflow; this document adds no route, command, persistence policy or search behaviour.

## Trustworthy copy constraints

- The example conversation is labelled as an example. Prices, apartment names and areas in it are either approved representative values or real currently published Units; never local test fixtures or invented numbers on the public page.
- Concierge lines in the example match what the product says (guest vocabulary module or approved output). Don't show answers the concierge can't give, such as facts the listing doesn't hold.
- Example chips and copy describe stays of 1–14 nights (ADR-0023). Monthly framing waits for an ADR superseding ADR-0023.
- Say "Request to Book" and "the Operator confirms before you pay"; don't say instant booking.
- Say "All-In Stay Total" and show the Refundable Security Deposit separately (ADR-0015, ADR-0016); don't claim "no hidden fees" unless the quote supports it.
- Say "inspected on [date] for [scope]" only where the published Unit carries that claim (ADR-0008). Trust strip lines describe the process, not the property.
- Payment is completed on the hosted provider page only where that capability is active; confirmation follows verified payment.
- No implied Guest KYC before booking, booking volumes, ratings, testimonials, partner logos or safety guarantees.
- All marketing copy lives in `apps/local-guest/src/landing-copy.ts`. New slots this direction adds (hero H1 and lede, trust strip, apartments heading, money timeline, nav labels) need owner approval before they ship.

## Accessibility and performance

- Semantic header/nav/main/footer, one H1, skip link, page title stating the service and cities. Focus moves from the app bar to the H1 and composer, then the chat window.
- The composer field has a persistent accessible label ("Describe your stay"); placeholder text is a hint, not the label. Example chips are real buttons. An icon-only send button has an accessible name.
- The chat window and the pinned phone are static, readable regions (`role="group"` with a label), not live regions.
- Status meaning never relies on colour alone: markers, banners, the rail and the money timeline carry text.
- Critical text and the composer paint first. No hero video, maps, third-party fonts or animation libraries. Font and image budgets as above.
- 44px minimum targets, 320px reflow and 200% zoom without loss (ADR-0078). Light and dark both come from tokens.

## Human decisions before landing implementation

Tracked in `.scratch/landing-page/issues/06-mix-direction-approvals.md`.

1. Approve the logomark and wordmark.
2. Approve the new copy slots: hero H1 ("Your apartment in Lagos or Abuja, *settled* in one conversation."), lede, trust strip lines, apartments heading, money timeline copy and nav labels.
3. Approve moving the "Nothing due yet" tags from every beat into the money timeline.
4. Supply and approve hero, closing and city-card photography of published Units, including one Abuja Unit, and the public inspection disclosure scope (ADR-0008).
5. Approve the example conversation's content: which Unit(s), representative prices and dates, and the exact concierge lines.
6. Confirm the landing-to-thread handoff seam (first message carried into a new conversation) with domain/application owners, including how it interacts with an existing active conversation.
7. Approve legal/privacy/terms URLs and a staffed support channel before the footer or FAQ promise them.
8. Decide when the Monthly Stay positioning (1–6 months) becomes the page's default framing; that depends on an ADR superseding ADR-0023 and the pending policy work.
