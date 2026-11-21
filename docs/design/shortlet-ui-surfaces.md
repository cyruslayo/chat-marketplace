# Shortlet UI surfaces: what the backend supports and what each screen should be

**Status:** Proposed 21 November 2026. This is an addendum to `docs/design/shortlet-ux-guidelines.md` (adopted 10 November 2026), not a second guideline. Its §2 (principles), §5 (screen contracts), §7 (visual system) and §8 (controls) still apply and are not repeated here.
**Precedence:** accepted ADRs → Guest UI kit and brand artifact (Xenia, Adire Indigo) → current behaviour → `shortlet-ux-guidelines.md` → this addendum. Colours are not specified here: the palette in the guideline's §7 predates the Xenia brand decisions; use the kit tokens.
**Inspected baseline:** branch `docs/ux-guidelines` at `69c9ac4`.

## 1. Question and answer in brief

**Question.** Given the APIs the backend actually exposes, which UI surfaces should the app provide, and what form should each take?

**Answer.**

1. The surfaces the booking journey needs already exist. Each route and event has a screen in chat and on a standard page, except the extended-stay period payment, which has no chat counterpart. Keep them and sharpen them; do not add new kinds of screen to the journey.
2. **The biggest gap is a returning guest's way back.** The platform already stores every thread per guest account (`findThreadsForPrincipal`), but no route or screen lists them. The only way back is the "still active" banner (`/api/committed-work`) or an old link. Build a **Your stays** overview at `/account/stays` (§5.1).
3. **After-booking actions cannot have screens yet.** The domain has logic for cancellation, amendments, mid-stay problems, stay reviews, check-out and the extended-stay notice, but no guest command or route reaches any of them. Designing screens for them would invent commands. Each needs a command, an ADR check and an issue first (§6).
4. The Operator back office is already shaped well: its home screen is a "needs your action" inbox. Keep it and make its detail screens clearer (issue 26 already covers this).

## 2. Sources and how they are used

| Source | How it is used here |
| --- | --- |
| *Human Interface Design: A Working Field Handbook* (based on Apple's *Macintosh HIG*, 1992) | The file supplied. Already the basis of the guideline. Used for the dialog question (§20, the inline / modeless / modal / alert choice), the control contract (§30–39), messages that give information, cause and next step (§45) and the P0–P3 severity scale (§50). |
| Tidwell, Brewer and Valencia, *Designing Interfaces*, 3rd ed. (O'Reilly, 2020) | The file supplied. Used for the screen-type system (Overview, Focus, Make, Do, ch. 2) and for named patterns: Feature, Search and Browse; Clear Entry Points; Escape Hatch; Progress Indicator; Deep Links; Sign-In Tools; Center Stage; Two-Panel Selector; Cards; Prominent "Done" Button; Preview; Cancelability; Good Defaults and Smart Prefills; Forgiving Format; Input Hints; Error Messages. Patterns are named, not quoted. |
| Norman, *The Design of Everyday Things* | Not supplied. Used only at the level of its principles, from general knowledge: signifiers, mapping, constraints, feedback, the conceptual model, and the gulfs of execution and evaluation. |
| Krug, *Don't Make Me Think* | Not supplied. Used only at the level of its principles, from general knowledge: self-evident pages, design for scanning, satisficing, conventions, the trunk test, omitting needless words, and the reservoir of goodwill. |

## 3. Eight surface rules drawn from the four books

These rules decide what a surface is. The guideline's §2 table decides how it behaves.

| # | Rule | Drawn from | What it means here |
| --- | --- | --- | --- |
| R1 | **Each screen has one type.** It is either an Overview (a list), a Focus (one thing), a Make (build a thing) or a Do (one task). | Designing Interfaces ch. 2 | Search results are an Overview. The apartment is a Focus. The draft is a Make. Review, offer and payment are each a Do. Never put two of these on one screen as equals. |
| R2 | **The next action is visible and labelled for what it does.** | HIG see-and-point; Norman signifiers; Prominent "Done" Button | Each Do screen has one primary button whose verb names the consequence: "Submit Booking Request", never "Continue". |
| R3 | **The system state is never ambiguous** (gulf of evaluation). | Norman feedback; HIG feedback §45; Progress Indicator | The journey rail (Search · Stay · Request · Offer · Pay · Confirmed) is the Progress Indicator on every booking screen. A request must never look like a reservation. |
| R4 | **A screen passes the trunk test.** Dropped onto any screen, a guest can tell which site this is, what the page is, where they are in the journey, and how to get back. | Krug; Escape Hatch; Clear Entry Points | The app bar carries the brand, a back link and the account. Every terminal state (declined, expired, failed) has an Escape Hatch to a new search that keeps the criteria. |
| R5 | **The guest picks; they do not compose commands.** | HIG see-and-point; Krug satisficing; Good Defaults and Smart Prefills | Chips, result cards and prefilled forms do the work. Free chat is help, never a required path (ADR 0080). |
| R6 | **Mapping follows the stay.** Dates, party and total sit beside the apartment they belong to and keep the same order on every screen. | Norman mapping; HIG WYSIWYG; Preview | The stay ticket (dates · guests · total) is one component, repeated from detail to review to offer to confirmation. |
| R7 | **Constraints prevent errors; messages repair the rest.** | Norman constraints; HIG forgiveness; Forgiving Format; Input Hints; Error Messages | Phone numbers accept local and +234 forms. A refused submit outside Operator Active Hours says why and when it opens again. |
| R8 | **Do not spend goodwill.** Interrupt only for a required decision. | HIG §20 dialog question; Krug's reservoir of goodwill; Cancelability | No modal for information. A long turn can be cancelled (issue 21). The only blocking confirmation is a money or consent step that is hard to reverse. |

## 4. What the backend exposes (ground truth)

Routes and events, read from `apps/local-guest/src/guest-server.ts`, `apps/local-guest/src/shortlet-app.ts`, `apps/local-owner/src/local-owner-server.ts`, `apps/cloudflare/src/worker.ts`, `apps/cloudflare/src/ops-routes.ts` and `apps/cloudflare/src/platform-do.ts`.

### 4.1 Guest: chat events (`POST /api/event`) and turns (`POST /api/turn`)

| Stage | Events |
| --- | --- |
| Search | `/api/turn` (free text), `shortlet.criteria.edit`, `shortlet.criteria.undo`, see-all discovery |
| Choose | `shortlet.discovery.view-unit`, compare unit, compare back, back to results |
| Request | request to book, `shortlet.request-draft.edit`, draft review, draft submit, draft replacement accept / keep |
| Contact | guest phone submit, guest email submit |
| Offer | `shortlet.conditional-offer.accept` |
| Pay | `shortlet.card-payment.initialize-checkout`, `shortlet.card-payment.verify-return` |
| Support reads | `GET /api/state`, `GET /api/committed-work`, `POST /api/telemetry` |

### 4.2 Guest: standard pages (ADR 0080 parity)

`/` (landing and chat), `/conversation` (no-JS chat), `/stays/search`, `/stays/:id`, `/booking-requests/drafts/:id` (+ `review`, `submit`, `edit`), `/booking-requests/:id`, `/conditional-offers/:id` (+ `accept`), `/payments/offers/:id` (payment choice), `…/continue` (card), `…/transfer` (bank transfer), `…/manual-transfer` (+ `receipt` upload), `/payments/paystack/callback`, `/booking-contracts/:id` (confirmed booking), `/bookings/periods/:id` and `/payments/periods/:id/:n` (extended-stay period payments), `/guest/contact` (phone, email), `/account` (+ `sign-in`, `sign-in/code`, `email`, `email/code`, `phone`, `sign-out`, `sign-out-everywhere`).

### 4.3 Operator back office

`/operator` (home: things to act on), `/operator/requests` (+ `:id`, `confirm`, `decline`), `/operator/bookings` (+ `:id`, `verified-access`, `blocking-complaint`, complaint `dismiss` / `uphold`, `guest-refund`), `/operator/transfers` (+ `receipt`, `confirm`, `reject`, `late-credit`), `/operator/payouts` (+ `:id`, `recovery`), `/operator/calendar` (+ unit `blocks`, block `remove`), `/operator/login`, `/operator/logout`.

### 4.4 Platform operations

`/_ops/*` (operators, bootstrap, inventory import, demo import, restore, import, verify, cutover, status, export). These are owner tools behind Access and a shared secret, and stay CLI only. **No UI.**

### 4.5 Classification

| Bucket | Meaning | Members |
| --- | --- | --- |
| **(a) Route and screen** | Keep it and improve it | Everything in §4.1–4.3 |
| **(b) Data or route without a screen** | A real UI gap that needs no new policy | The guest thread list (platform storage operation only); a chat counterpart for extended-stay period payments |
| **(c) Domain logic without a command** | Needs a command, an ADR check and an issue before any screen | Guest cancellation and no-show (`cancellation-noshow.ts`, ADR 0058), booking amendment (`booking-amendment.ts`, ADR 0060), mid-stay problem report (`mid-stay-failure.ts`, ADR 0061), relocation choice (`relocation-choice.ts`), check-in support and check-out (`checkin-support.ts`, `checkout-overstay.ts`), deposit claim (`deposit-claim.ts`), stay review (`verified-stay-review.ts`), extended-stay notice and changes (`extended-stay-changes.ts`, ADR 0092), government ID verification (`guest-verification.ts`, ADR 0084/0085), Operator listing editing (inventory is CSV import only) |

## 5. The recommended surface system

Each row is one surface. **Type** is the Designing Interfaces screen type. **Binds to** is the route or event that carries its authority. "Keep" means the surface exists and only the noted change is recommended.

### 5.1 Guest

| Surface | Type | Binds to | One primary action | Pattern | Recovery (Escape Hatch) | Key rule / ADR | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Landing and chat entry** | Overview (entry) | `/`, `/api/turn` | Start a stay search (city starter or typed message) | Clear Entry Points; Feature, Search and Browse | Typed message kept | R4, R5; ADR 0080, 0107 | Keep. Starters must stay above the fold at 320px. |
| **Search criteria strip** | Make (inline) | `shortlet.criteria.edit` / `undo` | Edit search | Good Defaults; Forgiving Format; Multilevel Undo (one level) | Undo the last chip edit | R5, R7; ADR 0092, 0106 (chip input is guest-authored) | Keep. |
| **Matching stays** | Overview | discovery surface, `/stays/search` | View apartment | Cards (phone list); Two-Panel Selector (desktop split) | Edit search; zero-results suggestions | R1, R6; ADR 0066 ranking | Keep. Each card carries one action. Compare stays a secondary link. |
| **Compare** | Overview (side by side) | compare / compare back | View one of the two | Small Multiples (two columns) | Back to results | R6 | Keep. Limit to two stays on a phone. |
| **Apartment detail** | Focus | `shortlet.discovery.view-unit`, `/stays/:id` | Request to Book | Center Stage; Media Browser (gallery); Titled Sections | Back to results, with the selection kept | R1, R6; ADR 0006 (no provider line) | Keep. Price block and the action stay visible without scrolling past the gallery on a phone. |
| **Draft request** | Make | request to book, `request-draft.edit`, `/booking-requests/drafts/:id` | Review request | Fill-in-the-Blanks; Input Hints | Edit dates or party in place | R3 (say "nothing is reserved yet") | Keep. |
| **Contact details** | Do (inline step) | phone / email submit, `/guest/contact` | Save phone number | Forgiving Format; Input Hints; Error Messages | Field error with cause and fix; draft kept | R7; ADR 0093 | Keep. Ask for contact only when the next step needs it, as now. |
| **Review request** | Do | draft review / submit, `…/review`, `…/submit` | Submit Booking Request | Preview (WYSIWYG); Prominent "Done" Button | Correct fields; revalidate a stale quote | R2, R6, R8; ADR 0041/0042 (Active Hours) | Keep. Show the Active Hours window before submit, not only after a refusal. |
| **Request sent / waiting** | Focus (status) | `/booking-requests/:id`, committed work | View current request | Progress Indicator; Spinners and Loading Indicators (non-modal) | Refresh status; new search after expiry | R3; ADR 0074 | Keep. Show the absolute WAT deadline. |
| **Draft replacement** | Do (decision) | replacement accept / keep | Keep or replace, as two labelled buttons | Button Groups | Keep is the safe default | R8 (the one justified interruption on this path) | Keep. |
| **Conditional offer** | Do | `conditional-offer.accept`, `/conditional-offers/:id` | Accept offer | Preview; countdown; Prominent "Done" Button | Expired → new search with criteria | R2, R3; ADR 0086 | Keep. |
| **Payment choice** | Do | `/payments/offers/:id` | Choose a payment method | Radio group (HIG §32) | Back to the offer while the window is open | R2; ADR 0087, 0088 | Keep. |
| **Card checkout handoff** | Do | `card-payment.initialize-checkout`, `…/continue` | Continue to secure payment | Deep Links (hosted page) | Provider unreachable → retry | R3; ADR 0087 | Keep. |
| **Bank transfer / manual transfer** | Do | `…/transfer`, `…/manual-transfer`, `…/receipt` | Copy account details; upload receipt | Input Hints; Cancelability | Waiting state with deadline | R3, R7; ADR 0090 | Keep (page only, accepted in guest UI issue 09). |
| **Payment check** | Focus (status) | `card-payment.verify-return`, `/payments/paystack/callback` | Check payment status | Spinners; Error Messages | Unknown outcome ≠ failure; no double payment | R3; ADR 0087 (a return is not proof) | Keep. Issue 07 covers the failure page. |
| **Reservation confirmed** | Focus | `/booking-contracts/:id` | View arrival steps | Titled Sections | Support route | R3, R6 | Keep. |
| **Extended-stay periods** | Overview + Do | `/bookings/periods/:id`, `/payments/periods/:id/:n` | Pay next period | List with due dates; Prominent "Done" Button | Missed period explained with consequence | R3, R6; ADR 0092 | **Gap (b):** no chat counterpart. Add a read-only chat card that links to the page, the way transfers do. Issues 27–28 cover the copy. |
| **Account** | Settings Editor | `/account/*` | Save (per section) | Sign-In Tools; Settings Editor | Inline field errors | R7; ADR 0093, 0094 | Keep. Add a "Your stays" link. |
| **Your stays** | Overview | **new** `GET /account/stays`, over the existing `findThreadsForPrincipal` | Open a stay | Cards; Deep Links | Signed out → sign in, then return here | R3, R4; ADR 0093 (the guest account owns threads), 0071 (redacted projections) | **New (b).** See below. |

**Your stays (new).** This surface serves the guideline's "returning or paying" job: *What is my current status, and what do I need to do?*

- **Content.** One card per thread with a booking stage: apartment name, dates, the current stage label from the journey vocabulary, and the next action with its deadline ("Pay by 14:20 WAT"). Stays that need action come first, then upcoming stays, then past or ended ones.
- **Data.** Read only. It projects existing thread state; it creates no command and states no new policy. Each card deep-links to the existing standard route for its stage (`/booking-requests/:id`, `/conditional-offers/:id`, `/payments/offers/:id`, `/booking-contracts/:id`).
- **Entry points.** The app bar's account action, the account page, and the "still active" banner, which today links to one item only.
- **Empty state.** "No stays yet", with a link to start a search.
- **Parity.** A chat answer to "where's my booking?" should return the same list as a card (ADR 0080). The current `no_current_booking` outcome becomes the empty state.
- **Library.** Reuse the stay card markup (`stayCardInnerHtml` in `guest-kit.ts`) on the page. Under ADR 0108, any chat component should come from the shared library (`packages/surface-kit`, phase 1 not yet built), so sequence the chat card after phase 1 or compose it from existing catalogue components. Do not create a new component.

### 5.2 Operator back office

| Surface | Type | Binds to | One primary action | Pattern | Status |
| --- | --- | --- | --- | --- | --- |
| **Home** | Overview (action inbox) | `/operator` | Open the most urgent item | Dashboard (sorted by deadline); Cards | Keep. The code already sorts by deadline (`waitingItems()`). Change: items with no deadline (refunds, over-payments) sort last, and each item shows an overdue tag and the time left. See `xenia-ui-kit-parity-audit.md` §4.2. |
| **Requests list and detail** | Overview → Do | `/operator/requests`, `…/:id`, `confirm` / `decline` | Confirm **or** Decline, as two separate buttons | One-Window Drilldown; Button Groups; Preview of the decision's effect | Keep. Issue 26 covers its clarity. |
| **Bookings list and detail** | Overview → Focus | `/operator/bookings`, `…/:id` | Record verified access | Titled Sections; Action Panel for less frequent actions (complaint, refund) | Keep. Group the rare actions (complaint dismiss / uphold, guest refund) into an Action Panel below the stay facts so they never compete with the main one. |
| **Transfers** | Overview → Do | `/operator/transfers`, `receipt`, `confirm` / `reject` / `late-credit` | Confirm the credit against the receipt | Two-Panel Selector (receipt beside the expected amount) | Keep. Show the receipt and the expected amount side by side; the decision is a comparison (ADR 0090). |
| **Payouts** | Overview → Do | `/operator/payouts`, `…/:id`, `recovery` | Mark payout handled / record recovery | Titled Sections | Keep. |
| **Calendar** | Focus | `/operator/calendar`, `blocks`, block `remove` | Block dates | Calendar grid; New-Item Row | Keep. Removing a block needs a clear before and after, not a modal. |

### 5.3 Shell elements on every guest screen

| Element | Pattern | Rule | Note |
| --- | --- | --- | --- |
| App bar: back, brand, account | Visual Framework; Sign-In Tools | R4 trunk test | The brand label still reads "Shortlet" in `appBarHtml`; the Xenia copy issue covers it. |
| Journey rail | Progress Indicator | R3 | Already shared (`.ui-rail`). A failed step shows as failed, never as progress. |
| Committed-work banner | Clear Entry Points | R4 | Point it at Your stays once that exists. |
| Mode label ("Concierge · Stays") | Signpost | R4 | ADR 0107. No mode switcher until a second domain ships. |

## 6. Bucket (c): after-booking needs that require a command first

These are real guest needs. The domain models them, but no guest command or route exists. **No screen is designed here.** Each needs, in order: a check of the ADR named, a platform command (ADR 0072), an issue, and only then a surface. The surface column says what form it would most likely take, so that the command is designed with the screen in mind.

| Guest need | Domain module | Governing ADRs | Likely surface once a command exists |
| --- | --- | --- | --- |
| Cancel a booking | `cancellation-noshow.ts` | 0058 | Do: show the refund under the catalogue before confirming; one blocking confirmation (HIG §24, hard to reverse) |
| Change dates or party | `booking-amendment.ts` | 0060 | Make → Do: a versioned amendment with before and after (HIG §54 pattern) |
| Report a problem during the stay | `mid-stay-failure.ts`, `relocation-choice.ts` | 0061 | Do: pick the problem from a fixed list, then a relocation choice when the remedy matrix offers one |
| Check in / check out help | `checkin-support.ts`, `checkout-overstay.ts` | 0085, 0091 | Focus: arrival steps on the confirmation, then a check-out reminder |
| End an extended stay with notice | `extended-stay-changes.ts` | 0092 | Do: the notice date and the last period charged, shown before submit |
| Review a stay | `verified-stay-review.ts` | 0066 | Make: short form after check-out |
| Verify identity | `guest-verification.ts`, `guest-identity-assurance.ts` | 0084, 0085, 0094 | Do: hand off to the provider at check-in, never as a booking gate |
| Edit a listing (Operator) | inventory import only | 0065, 0066 | Make: Operator listing editor; today inventory is owner CSV import |

## 7. Where this differs from the guideline's §5

| Guideline §5 | This addendum | Reason |
| --- | --- | --- |
| No returning-guest list; the "persistent current-stay summary" is a requirement in §3 with no screen contract | Adds a **Your stays** contract (§5.1) | The data exists; §3's "returning or paying" job has no surface today |
| "Payment pending: Check payment status, if available" | Unchanged; adds the period-payment chat card | ADR 0080 parity for extended stays |
| Operator detail: Confirm or Decline separately | Unchanged; adds Action Panel grouping for rare booking actions and a side-by-side transfer check | Bookings and transfers detail screens were not in §5 |

No conflict with an accepted ADR was found. If an implementation issue finds one, record it rather than resolving it silently.

## 8. Recommended next issues, in order

1. **Your stays overview** (guest, bucket b). Add a read route at `/account/stays` over `findThreadsForPrincipal`, the existing stay card markup, a chat parity card (after surface library phase 1), and link it from the app bar, the account page and the committed-work banner. Test with a cold restore, as for the concierge assistant path. Severity P1: the returning-guest job cannot be completed without an old link.
2. **Extended-stay period card in chat** (guest, bucket b). A read-only card that deep-links to `/bookings/periods/:id`. P2.
3. **Operator home (items with no deadline last, overdue tag), plus booking-detail Action Panel and the transfer side-by-side** (Operator). The deadline sort already exists. Fold into issue 26 if it is still open. P2.
4. **Active Hours shown before submit** on the review screen (guest). P2: today the window is only learned through a refusal.
5. **Bucket (c) triage.** One `needs-triage` issue per row of §6, starting with cancellation, which is the most likely guest question after "where's my booking?". Each starts with its ADR, not a screen.

Each UI issue ends with the capture and reflow checks in `AGENTS.md` ("Guest UI work").
