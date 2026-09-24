# Shortlet Public Landing Page Direction

This is a public information architecture and design specification, not a new route or implementation. The live application currently opens directly into a “Local demo” chat. The intent is to introduce a credible Abuja/Lagos short-stay service and hand the Guest into the same concierge journey with search context intact. See the [UI/UX audit](shortlet-ui-ux-audit.md) and [design system](shortlet-design-system-direction.md).

## Job and audience

Help someone looking for an entire-place short stay in Abuja or Lagos understand what Shortlet offers, specify their stay, see useful matches, and know how Request to Book and payment become a Reservation. Give returning Guests a clear route back into their current request/conversation. Avoid promises that are not supported by current inventory/operations. The page is not a hotel marketing campaign, dashboard, or AI demo.

## Page architecture

| Order | Section | Content and interaction | Design/claim rules |
| --- | --- | --- | --- |
| 1 | Header | Shortlet wordmark left; compact links “Explore stays”, “How booking works”, “Help”; one prominent “Find a stay” action. Returning Guest’s current booking/conversation link can appear only when session state exists. | At 320–390px, use wordmark + accessible menu control and one discovery CTA, or collapse secondary links into a clearly named menu. Do not create permanent Guest nav tabs for features not implemented. Skip link targets main. No operator dashboard link in the Guest primary nav. |
| 2 | Hero | Editorial title e.g. “Find your next stay in Abuja or Lagos.” One short supporting line describes entire-place short stays and operator-confirmed requests only after business copy approval. Large real approved interior photo or one representative listing image, not a gradient/AI motif. | City emphasis via words and compact location choices, not fake occupancy/ratings. Maintain legible text over solid surface; don't overlay type on busy photo. Avoid invented availability/quality claim. |
| 3 | Discovery entry | Compact form: destination (Abuja/Lagos/neighbourhood text), dates or duration, guest count; primary “Find stays”. Explain dates/party improve all-in quote. If dates are not yet picked, do not promise final total; use the current application’s own qualified indicative-rate language only if supported. | Form has persistent visible labels, sensible autocomplete/inputmode, native date controls where suitable, validation text and no auto-submit on focus. One column at phone; 2–3 grouped fields only when space. Submitting intent opens the concierge with context. |
| 4 | City paths | Two compact editorial links/cards “Abuja” and “Lagos”, each with neighborhoods only if current published inventory supports the named area. | Do not claim city-wide coverage from a few units. Do not expose stale sample inventory as current. Availability/results always come from live authoritative search. |
| 5 | Stays to explore / featured inventory | Optional small set of actual published Units; if inventory feed cannot guarantee freshness, use “Explore by city” visual links rather than fake featured inventory. Cards lead to Unit detail/discovery through existing capabilities. | No fabricated price, image, ratings or “featured” rank. Use exact all-in quote for selected dates/party or clearly qualified indicative pricing. No decorative card grid clutter on mobile; one horizontal rail only if keyboard-accessible, otherwise stacked cards. |
| 6 | How booking works | Three concise stages: “Choose a stay” → “Operator confirms” → “Pay to confirm your Reservation.” Add a clear line: submitting a Draft does not reserve dates; when the Booking Request is disclosed it follows the presented response deadline; operator confirmation opens a time-limited Offer/payment stage. | Match ADR-0005, 0041, 0044. Do not imply instant booking or call request itself a booking/Reservation. Use illustrations only if small, high contrast and optional. |
| 7 | Price and payment | Explain that All-In Stay Total for dates/party includes mandatory charges; refundable security deposit, when applicable, is shown separately and is not stay cost; hosted card checkout is separate from Shortlet and verified payment is required for confirmation. | Avoid hidden fees claim unless verified by price definition; avoid “100% secure” or “guaranteed.” Paystack/provider wording appears only if pilot enabled/capability gates permit. |
| 8 | Listing trust / inspection | Explain only what supported listing evidence means: a unit-specific physical inspection is dated and checks stated scope/observable listing accuracy at that time. Operator provides accommodation and confirms date availability. | Never call property “fully verified”, guaranteed, safety-certified or quality-assured. Show inspection date/scope from authoritative published Unit where present; otherwise avoid generic site-wide inspection claim. |
| 9 | Guest identity / check-in clarity | A concise FAQ or booking explanation may clarify online Guest ID verification is not performed before booking for this pilot; any identity step/access process is handled separately in the applicable check-in flow. | Do not imply KYC collection at booking. Do not describe future human procedure that has not been defined. No “Verified Guest” badge. |
| 10 | Social/trust evidence slot | Launch default: omit until authenticated review/trust evidence exists. Design can reserve a reusable quote/ratings area privately for later, but no guest-visible fake placeholder. | No invented testimonials, booking volumes, logos, ratings, guarantees or statistics. Real Verified-Stay Review requires appropriate domain status and consent. |
| 11 | FAQ | “Does a request reserve dates?”, “When is my stay confirmed?”, “What does the total include?”, “Is a deposit included?”, “Where do I pay?”, “Do I verify identity online before booking?”, and “What if payment is still pending?” Answers reuse current approved facts and link into help/contact only if supported. | Use accessible disclosure controls with keyboard and visible expanded state. Keep concise answer available without chat. Do not invent support SLAs/contact channels. |
| 12 | Footer | Wordmark, Explore, booking explanation, contact/support link only if current channel is staffed/approved, privacy/terms links only if published/approved. | No absent legal policy promises or partner logos. Footer links remain 44px targets at mobile. |

### Landing visual hierarchy

Hero title and stay intent form carry the first viewport. Place one strong landscape/room photo beside or behind an opaque photo region, not a large text/photo split that pushes discovery form below fold on small laptop/mobile. The strongest button is “Find stays”. Secondary options “Explore Abuja” and “Explore Lagos” remain visually quieter. Avoid large “Ask our AI” copy, robot/avatar illustrations, chat-window mockups, gradients, decorative metrics, multi-color destination pills and card grids stacked inside cards. Use real inventory photography when approved; stable neutral fallback otherwise.

Desktop may place search entry in a horizontal band under a centered hero title; at 320–390px keep it single column with date/duration and guest inputs on separate lines. The first view must still state both city launch areas and include usable discovery action without requiring scroll. Lower page sections use bounded readable width and varied text/image groupings, not a 12-card dashboard grid. Header remains in normal document flow or subtle sticky bar without backdrop blur requirement.

## Landing-to-concierge handoff

### Preferred interaction

The search controls collect only intent that is genuinely available in current domain/application behavior: location/city, stay dates or duration, guest count. Do not imply this creates a quote or holds inventory. On submit, the product transitions directly to the concierge shell, showing a small “Your search” context summary (city/neighborhood, dates/duration, guest count) at its top or in the first assistant turn, then current deterministic results when search completes. The entry point is conceptually `intent → concierge → useful results`; user should never arrive in an unrelated empty composer.

### Context continuity rules

- Preserve typed context visibly while the concierge initializes and while response is pending; do not require retyping.
- Display dates as local dates and party count in text. If a field is incomplete or ambiguous, carry only known facts and ask the next missing clarification; don't silently invent defaults.
- Keep a way to edit/refine the query from the concierge and after results are returned; do not make context an inaccessible one-time URL token.
- Search submit is a read/discovery action; it does not create Draft, Booking Request, Operator hold, Reservation or payment attempt.
- If search errors, retain field values and provide retry/edit; if no results, retain the request parameters and offer refinements.
- If the active Guest already has restored authoritative state, prioritize “Continue your request” and do not replace a booking workspace with a new intent unless the Guest explicitly starts another search and architecture supports it.
- Do not put personal contact fields, Guest identity, payment details or bearer credentials into public query URLs. Search context may be represented by allowed non-sensitive state only after existing application boundary is reviewed.

This is an experience target only. The current UI has no public landing or established landing-form-to-thread handoff. A later implementation must confirm a deterministic route/application seam with domain owners and maintain ADR-0080 semantic parity; this document adds no route, command, context persistence policy or new search behavior.

## Trustworthy copy constraints

- City pages/cards say “Abuja” / “Lagos”; neighborhood examples appear only for currently published inventory.
- Say “Request to Book” and “Operator confirms availability before payment”; don't say instant booking.
- Say “All-In Stay Total” and disclose deposit separately when applicable; don't say hidden fees or no additional charge unless that exact quote supports the statement.
- Say “unit inspected on [date] for [scope]” only where the published unit carries that verifiable claim; avoid generic safety certification language.
- Explain that payment is completed through hosted provider page only when the active capability is such; exact amount shown before handoff and booking confirmed only after payment verification.
- Do not imply Guest KYC before booking, Guest verification, booking volume, rating, testimonial, partner, safety guarantee or universal property quality.
- Trust proof placeholders remain authoring notes, not visible modules in the launch page.

## Landing-specific accessibility and performance

- Semantic header/nav/main/footer, one H1, skip link and page title that says the service and destination proposition. Focus order moves from logo/navigation into main heading and search fields then result/value sections.
- Every discovery field has persistent visible label. Provide one concise instruction above group; inline specific errors tied to field. Use appropriate mobile keyboard and autocomplete without relying on placeholder examples. Don't auto-open concierge on a partially completed form.
- Hero image has explicit dimensions/aspect ratio; alt text describes the depicted actual accommodation scene. If decorative, empty alt and adjacent text supplies all meaningful context. First visible image may load eagerly; below-fold inventory media lazy-loads.
- Search heading, city links and button text communicate meaning without color. Buttons and menu 44×44px minimum. 200% text zoom and 320px reflow preserve content/fields without horizontal scrolling.
- Critical heading/form text paints first; no large hero video, external font service, map or remote animation dependency. Provide textual city discovery links when photos are slow/unavailable. Skeleton placeholders preserve photo dimensions and never replace result price/state with shimmer-only text.
- Respect reduced-motion setting. Any menu/disclosure exposes expanded state and keyboard operation; no autoplay carousel. Focus is not trapped in a non-modal search affordance.

## Human decisions before landing implementation

1. Approve public brand/wordmark and content tone; this design doesn't invent a final tagline.
2. Choose source of actual featured inventory and freshness guarantees; omit featured grid if feed ownership is unclear.
3. Approve legal/privacy/terms URL and support channel/contact hours before publishing footer FAQ commitments.
4. Confirm whether to show dates, nights or both on hero entry given existing deterministic search inputs and local date conventions.
5. Confirm existing route/thread context handoff can accept search facts without exposing sensitive state or changing behavior; otherwise implementation plan requires domain/application review before adding it.
6. Approve listing photography and public inspection disclosure scope based on ADR-0008 and current data.
