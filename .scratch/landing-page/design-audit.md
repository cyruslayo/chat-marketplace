# Landing page design audit (/welcome)

Date: 12 Oct 2026 · Branch `feat/landing-page` · Captures were made with `capture-audit.ts` at 1440 and 390, light and dark, reduced motion. Later runs of that script overwrote them with the redesigned page, so they are not committed. For the page as audited, see `screenshots/05/`, which was captured just before the audit.

## 1. Verdict

The page is **correct but not designed**. It meets the spec: copy rules, ADR vocabulary, 44px targets and no overflow. What it lacks is the layer that makes a site feel professionally built: a brand, a layout grid, rhythm, imagery, and one strong visual idea. Five root causes explain almost all of it:

1. **No brand system.** No web font is loaded (`document.fonts` is empty). Headings use "Iowan Old Style", which is only on Apple devices, so Windows and Android get **Palatino Linotype / Book Antiqua**, a 1990s Office font. Body text is `system-ui`, so the brand looks different on every OS. There is no logo mark: "Shortlet" is plain serif text. One green and one beige carry the whole page.
2. **No layout grid.** The header and footer start at x=32. Main content starts at x=113–120. The hero phone top (y=146) doesn't line up with anything on the left (eyebrow y=175, H1 y=204). The beats use `1fr / 24rem` columns that swap sides, so on even beats the phone floats in the middle of a wide column (x=297) and the caption is pushed to the far right. The zig-zag reads as random, not intentional.
3. **The product mockup is the only visual, repeated six times.** Six identical white phones, each with its own "Shortlet" title bar and six-step rail, on the same beige canvas. There is no photography of Lagos or Abuja at scale, no people, no place, no colour change between sections. The four good apartment photos in `assets/landing/` appear only as 64px thumbnails.
4. **Every beat stacks five weak elements.** Eyebrow → "Nothing due yet" pill → ⚠ "Instead of ~~struck-through pain~~" → H3 → body. The warning icon and strikethrough read as error states. Four of five beats repeat "Nothing due yet". Seen together, the page looks like form validation, not a story.
5. **Unfinished seams are visible.** `[AREAS WITH PUBLISHED INVENTORY]`, `[APPROVED FEE ANSWER]`, `[Support · once staffed]` and `[Privacy · Terms]` render publicly. There are two missing-space bugs: "Reservation confirmed**Old** Ikoyi" and "3 Sept 2026**Your** dates". On a public page, these alone make it look amateur.

## 2. What the best pages do (research)

Reviewed live on 12 Oct 2026: **Blueground** (closest competitor: furnished, monthly, managed), **Plum Guide** (curated stays, editorial), **Kasa** (managed apartments), **Wise** (trust through price transparency, the closest analogue to "All-In Stay Total"), **Linear** (layout and nav craft). Mindtrip, a chat-first travel product, sits behind a bot check and was not reviewed.

| Pattern | Who does it | What it looks like |
| --- | --- | --- |
| **A real brand mark and a custom typeface** | All five | Logomark plus wordmark (Blueground's grid icon, Linear's disc, Wise's flag). A licensed or self-hosted display face with tight tracking. Plum Guide pairs a serif with an *italic accent word* ("No time for *average* stays"). |
| **Place and people in the first viewport** | Blueground, Plum Guide | Blueground puts a five-photo mosaic of lived-in interiors, with people, directly under a centred hero. Plum Guide uses a full-bleed destination photo behind the search. Hospitality sells the feeling of being there. |
| **The product as the hero, built big** | Wise | The hero *is* the live quote widget: big numbers, the fee and arrival time shown inline, a photo header inside the card. It proves "no hidden fees" instead of saying it. This is exactly Shortlet's All-In Stay Total story. |
| **A trust strip right under the hero** | Wise, Blueground, Linear | Three or four facts in a row with icons and hairline dividers (Blueground's "100,000+ homes · 50+ countries", Wise's "Trusted by millions · 24/7 support"). |
| **Disciplined nav** | All | Logo left; 3–5 text links; one filled primary button right; sticky with a blur or solid surface on scroll. Settings such as language and theme are small icons, never the loudest thing in the bar. Industry guidance for single-goal landing pages is to strip the nav to the conversion path ([LanderLab](https://landerlab.io/blog/landing-page-best-practices), [Learnybox](https://learnybox.com/en/blog/landing-page-best-practices/)). |
| **Section rhythm through surface changes** | Blueground, Plum Guide, Kasa | Alternating backgrounds (cream → white → deep navy → photo band) mark chapters. Kasa switches to a full-width dark section for "Flexible spaces for every trip". |
| **A scroll story with one sticky visual** | Blueground ("Why guests choose…"), Linear | A left column of 3–4 steps; the right visual stays pinned and changes as you scroll, with the active step highlighted and the others dimmed. One device, not six. |
| **Mobile and speed** | Travel generally | About 60% of travel traffic and 62% of bookings are on phones; a 1s page converts about 2.5× better than a 5s page ([Swipe Pages, citing Promodo](https://swipepages.com/blog/landing-page-examples/)). Photo-led hospitality sites still ship optimised hero images ([Colorlib hotel roundup](https://colorlib.com/wp/hotel-websites/)). |
| **Proof near the top** | Travel case study | A shallower hero, proof near the top and direct links to price and calendar below the hero lifted sign-ups 5% ([Conversion Rate Experts](https://conversion-rate-experts.com/party-hard-travel-hero-redesign-win-report/)). |

## 3. Section-by-section findings

Severity: **P0** looks broken or unfinished · **P1** makes it look amateur · **P2** polish.

### Navigation (`screenshots/audit/nav-zoom.png`)
- **P1** The **theme switch is the biggest thing in the nav**: a 52px beige pill with labels, louder than the 44px primary button. Three different control styles sit in a row (segmented pill, grey text link, outlined button).
- **P1** **Icons ride high** in the switch: the sun and moon sit above the label baseline with no gap ("☀Light").
- **P1** **The primary CTA is outlined (secondary style)** in the bar but filled in the hero. Same label, two styles.
- **P1** **Header gutters (32px) don't match the content (113px)**. The wordmark and the H1 don't share a left edge.
- **P1** Only one link ("How it works"). The bar feels empty on the left and crowded on the right.
- **P2** Not sticky; a plain white bar with a hairline on a cream page. No brand mark.
- **Mobile** The bar is wordmark, a bare moon icon and "How it works". There's no primary action in the bar, and the moon is an unlabelled glyph with no visual container.

### Hero (`fold-light-1440.png`, `fold-light-390.png`)
- **P1** **A four-line H1 at 68px in Palatino** fills the left column. The headline is a sentence of instructions, not a promise you can scan. "Tell us your trip. See only what you can book, at the full price." has two ideas and no hook.
- **P1** **Vertical rhythm is uneven**: the lede sits 12px under the H1, but there's an 80px gap before the composer and about 100px of dead space under the hint.
- **P1** **The composer is a fake field** (an `<a>` styled as an input). It's a 999px pill around an 8px-radius button, so the radii fight. The button text is a 4-word sentence. It looks like a form and isn't one, which users notice when they click to type.
- **P1** **The hero phone is small, centred in its column and shown in its "Stay" state**, so the first frame already has the rail half done. Its title bar says "Shortlet" again, right below the site's own "Shortlet".
- **P1** **No sense of place.** The eyebrow says "Lagos and Abuja", but nothing visual does: no skyline, no interior at scale, no warmth.
- **P0 (mobile)** The phone **opens clipped**: a sliver of a grey bubble at the top, five lone dashes for the rail, and the stray rail segment on the left edge (`m-phone-top.png`). The composer placeholder wraps onto two lines, and the reassurance line falls below the fold.

### "How it works" beats (`full-light-1440-part1..3.png`)
- **P1** **The zig-zag has no shared axis.** The caption column is 768px wide while the text is 500px, so odd beats leave a 270px hole in the middle. Even beats float the phone to x=297.
- **P1** **Five metadata layers per beat** (eyebrow, status pill, pain line, H3, body). The pills and ⚠ icons dominate, and the strikethrough lowers contrast and is announced oddly by screen readers.
- **P1** **Section height is 3,155px**, about 3.5 desktop screens of beige with the same white card. There's no variation, numbering graphic, progress line or colour shift to show progress.
- **P1** **The H3s differ in length**, so the captions wrap differently per beat (one line on beat 1, two on beat 2).
- **P2** "Example booking · real app screens" floats alone after the last beat, far from what it labels.
- **P2** The Waiting and Confirmed beats lean on the yellow and mint banner colours, which clash with the restrained palette and look like system alerts.

### FAQ
- **P0** Two answers are bracketed placeholders.
- **P1** Six static cards in a 2×3 grid, not accordions. The answer spacing differs between cards: card 2 has an extra top gap when the question wraps differently.
- **P2** "Questions, answered plainly" is set at H2 size over two lines, as loud as the main section headline.

### Closing CTA
- **P1** A repeat of the hero composer, stretched to 1200px wide. A 1200px fake input looks like a broken search bar. There is no closing visual, colour band or emotional moment.

### Footer
- **P0** Bracketed placeholders in public view.
- **P1** The wordmark and links are left-aligned at 32px, out of line with the content above. One real link; no columns, no city list, no company line, no copyright.

### Dark mode (`fold-dark-1440.png`)
- **P2** The inverted green CTA becomes mint with dark text, while the user bubble is mint with dark text too. Primary action and chat bubble now look the same. Otherwise the tokens carry over cleanly; dark is not the problem.

### Things that are good and should be kept
- The core idea (the page is the conversation) is distinctive. Nobody in the reference set does it.
- The copy deck is honest, specific and well-tested against ADR wording.
- Real app components, so the landing promise matches the app.
- Accessibility basics are solid: one H1, skip link, 44px targets, no overflow at 320px.
- The stay ticket (deep green, big dates) is the most "designed" object on the page. It hints at what the whole page could feel like.

## 4. Gap table

| Best practice | Shortlet today | Gap |
| --- | --- | --- |
| Logomark + custom typeface | Text wordmark; OS-dependent fonts | No brand identity; looks different on every device |
| Place/people imagery above the fold | None at scale | Hospitality page with no hospitality |
| Product-as-hero, built big (Wise) | Small phone, same style as five others | The hero visual isn't special |
| Trust strip under hero | None (spec bans ratings/volumes) | Need *honest* trust facts: Operator-confirmed, All-In price, pay only after yes, Lagos · Abuja |
| Disciplined sticky nav, one filled CTA | Loud theme pill, outlined CTA, misaligned | Nav looks improvised |
| One 12-column grid, shared edges | 3 different left edges | Nothing lines up |
| Section rhythm (surface changes) | One beige surface for 5,000px | Monotone, no chapters |
| Scroll story, one pinned device | Six separate phones | Repetition instead of narrative |
| Clean, finished copy | Placeholders and missing spaces | Looks unfinished |

## 5. Rules in the direction doc that are holding the design back

These are owner decisions, not bugs. The current look follows them faithfully:

| Rule (`docs/design/shortlet-landing-page-direction.md`) | Effect | Suggestion |
| --- | --- | --- |
| "No remote fonts" | Fell back to system fonts | Self-host one woff2 display face (~25 KB subset). It's not remote, and it's the single biggest quality jump. |
| "No hero photo is required" | No place imagery | Allow one optimised photo or photo band, as long as the composer stays above the fold. |
| "Use the kit's existing tokens and components only… never a separate marketing look" | The page looks like the app's settings screen | Keep kit components *inside* the phone; allow a marketing layer (type scale, sections, photography) *around* it. |
| "No gradients, glass, glow… device-frame chrome beyond a simple rounded border" | Flat white cards on beige | Keep the ban on glow and glass; allow surface colour bands and a richer device presentation. |
| "No ratings, testimonials, booking volumes, partner logos" | No proof anywhere | Fine to keep. Replace with *process proof*: the Operator confirms, inspection-dated listings, the all-in price breakdown. |

## 6. Possible directions (for the next discussion)

- **A. "Editorial Lagos"** (Plum Guide × Blueground): self-hosted serif with an italic accent word, a full-bleed Lagos/Abuja interior photo band, the composer floating on it, a trust strip below, then one sticky phone scroll story with the five steps on the left. Warm, premium, place-led.
- **B. "The quote is the hero"** (Wise): the hero is a large live-looking stay card. The guest's message, two priced results, and the All-In Stay Total broken down in big numerals. It proves the price promise instantly. Bold sans display face, deep green brand blocks, photography inside the card.
- **C. "One conversation, pinned"** (Linear × the current concept): keep the chat-first idea, but build it properly. One large device pinned centre-stage on desktop, steps scrolling past it with a progress line, dark green chapter bands, and a proper brand mark and type. The least change to the copy and the components.

All three need the same foundation work first: a brand mark, a self-hosted typeface, a 12-column grid with one content edge, a rebuilt nav, the placeholders removed and the two spacing bugs fixed.

## Sources
- [LanderLab: Landing page best practices 2026](https://landerlab.io/blog/landing-page-best-practices)
- [Learnybox: Landing page best practices 2026](https://learnybox.com/en/blog/landing-page-best-practices/)
- [Swipe Pages: 40 best landing page examples 2026](https://swipepages.com/blog/landing-page-examples/)
- [Colorlib: hotel websites](https://colorlib.com/wp/hotel-websites/)
- [Conversion Rate Experts: travel hero redesign win report](https://conversion-rate-experts.com/party-hard-travel-hero-redesign-win-report/)
- [Lovable: navigation best practices (cites Baymard 2025)](https://lovable.dev/en/guides/website-navigation-best-practices-that-convert)
- Live reviews: theblueground.com, plumguide.com, kasa.com, wise.com, linear.app (12 Oct 2026)
