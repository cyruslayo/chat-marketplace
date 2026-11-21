# Xenia UI kit: parity audit against the backend, the guidelines and the surface plan

**Status:** Audit, 21 November 2026. This document reviews the design session's export `Xenia Atomic UI Kit.html` (owner's Downloads, 21 Nov 2026, 12:41; not copied into the repo) and defines the work needed for a high-fidelity kit the front-end team can build from.
**Checked against:**
- `docs/design/shortlet-ui-surfaces.md`, the surface plan; this pass corrects it, see §7.
- `docs/design/shortlet-ux-guidelines.md`.
- The brand design system <https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d> (`project/tokens.json`, `open-decisions.md`).
- The four books (see the surface plan §2).
- The code at `69c9ac4`: `apps/local-owner/src/local-owner-server.ts`, `back-office-view.ts`, `local-owner-environment.ts`, `domains/shortlet/src/checkin-support.ts`, `manual-transfer.ts`, `apps/web/src/shortlet-foundations.css`.

## 1. Verdict

1. **What the kit covers, it covers at high fidelity and stays true to the backend.** All three Operator groups are faithful to the backend: home by deadline, booking detail, and transfer check. Each board shows four widths, both themes, every state, a spec board and a copy-review board. Every backend fact they rely on exists. See §4.
2. **It covers half the brief.** It has none of the three guest groups: Your stays, the extended-stay period card, and Active Hours on review. See §2.
3. **It is a set of screens, not yet an atomic kit.** The boards name about fifteen components ("Queue items", "Record check-in", "Verify a manual transfer", "Status word", "Receipt preview"…). None of them is drawn, specified or published on its own. The brand design system's component layer holds only `Cover` and `Placeholder`. Without that layer the front-end team cannot reach parity: they would rebuild the components by eye from screenshots.
4. **The kit's tokens are the brand's.** Its colour, type, spacing and radius values match `tokens.json` exactly. The gap is between brand and code: the code still runs the retired green palette under different token names. See §5.

## 2. Coverage against the surface plan

| # | Screen group (surface plan) | In the kit | Notes |
| --- | --- | --- | --- |
| 1 | Your stays (guest, new) | **Missing** | The highest-priority gap in the plan (P1) |
| 2 | Extended-stay period card in chat (guest, new) | **Missing** | |
| 3 | Review request with Active Hours (guest, change) | **Missing** | |
| 4 | Operator home by deadline | In the kit | 6 items, empty, loading, error; light and dark; 320–1280 |
| 5 | Operator booking detail with action panel | In the kit | Awaiting access, complaint open, refund step, refunded, stale, loading, error |
| 6 | Operator transfer check side by side | In the kit | Waiting, no receipt, confirmed, declined, late credit, stale, loading, error |
| — | Operator requests list and detail (confirm / decline) | Not in the brief | Issue 26 covers its clarity; the kit's nav links to it |
| — | Operator payouts and calendar | Not in the brief | Same back-office frame; not redrawn |
| — | Operator sign-in | Not in the brief | |
| — | Existing guest journey (landing → confirmation, account) | Not in the brief | Still drawn in the retired green on the guest UI canvas `TKQCWTF4SWNscKrjLkN1zX`. **Scope decision for the owner** (§8, D1) |
| — | Component layer (atoms, molecules) | **Missing** | §1 point 3 |

## 3. Review against the four books

Scored with the guideline's P0–P3 scale. No P0 or P1 findings in the Operator boards.

| Rule (surface plan §3) | Finding | Severity |
| --- | --- | --- |
| R1 One screen type | Each screen has one type and the spec names it: home is an Overview, booking detail a Focus with one Do, transfer a Do | Pass |
| R2 Visible, honest next action | Only the most urgent home item gets the indigo button; the others are quiet. Every Do names its effect ("What this does", "What this changes") before the button | Pass |
| R3 State never ambiguous | Overdue uses an icon, a word, an absolute time and position, not colour alone. Warning is kept apart from danger | Pass |
| R4 Trunk test | Brand, section, breadcrumb, signed-in identity. **At 320px and 390px the side navigation wraps onto two or three rows of tabs above the content**, so the page title lands below the fold on a small phone (Designing Interfaces: Bottom Navigation or a compact menu; Krug: keep the page name visible) | P3 |
| R6 Mapping | The transfer check puts the receipt beside the expected credit from 768px; below that, the receipt comes first and the expected facts follow | Pass |
| R7 Constraints | The bank transaction reference has a label and a hint ("From the business account, not from the Guest's receipt"). At 320px its placeholder is cut off; the label still carries the meaning | P3 |
| R8 Goodwill | One blocking step only (the refund), done in the page with focus moved to its heading, not as a modal | Pass |
| HIG §45 messages | Errors follow problem → effect → next action ("This list didn't load" → "Nothing was changed. Deadlines keep running" → "Reload the list") | Pass |

## 4. Backend parity, element by element

### 4.1 Exists as designed (no backend work)

| Kit element | Backend evidence |
| --- | --- |
| Home sorted by deadline | `waitingItems()` in `local-owner-server.ts` already sorts all five kinds by `dueAt` |
| Home item kinds and titles | Same five titles in `waitingItems()` |
| Verified Access with two bases | `checkin-support.ts`: "The Guest confirmed access to me directly", "I or platform staff handed over access at the unit" (ADR 0091) |
| Complaint dismiss reasons, uphold by first affected night ("first night: everything paid is refunded") | `COMPLAINT_DISMISSAL_LABELS`; `local-owner-server.ts:453` (ADR 0061) |
| Refund step needing the Paystack refund reference | `/operator/bookings/:id/guest-refund` form |
| Confirm needs the bank transaction reference; the receipt is "not proof of payment" | `local-owner-server.ts:573` (ADR 0090) |
| Reject reasons "Not received" and "Amount doesn't match" | `TRANSFER_REJECTION_REASONS` |
| Late credit only after a decline or expiry | `local-owner-server.ts:575`: shown only when the status is `expired` or `rejected` and no refund is owed |
| A second decision is refused (stale) | Every form carries its version (ADR 0072); "This Reservation changed since you opened it" is code copy |
| Guest phone on the booking detail | `OperatorReservation.phoneNumber` (ADR 0075: for coordination only) |
| Request reminders ("reminder at 25") | `operatorResponseReminderDue`; the offsets live in the domain (ADR 0041) |
| Exact amount, reference `exp_trf_…`, Verify by | Transfer projection; the reference format matches the open ADR 0047 note in AGENTS.md |

### 4.2 Needs a view change only

| Kit element | Today | Change |
| --- | --- | --- |
| Items with no deadline sort last | Refunds and over-payments use their "since" time as `dueAt`, so they sort in among real deadlines | Give them a "no deadline" flag in `WaitingItem` and sort them after deadline items, oldest first. Keep "Owed since" as display text |
| Overdue tag, "N minutes overdue", time left | Home shows the due time only | Compute from `dueAt` and the clock at render, lazily (AGENTS.md anti-pattern 2) |
| Home empty state | "Nothing is waiting on you" | Copy decision, §6 |

### 4.3 Needs a new read route

| Kit element | Today | Choice |
| --- | --- | --- |
| A transfer detail page with a breadcrumb ("Transfers / Emeka Bello") | Transfers are one list page; home links to `/operator/transfers#transfer-…` | **Recommended:** add `GET /operator/transfers/:id`, which renders the same card with the side-by-side layout. The alternative is to adapt the design to an expanded row in the list, but the side-by-side check needs the width. |
| Receipt shown inline | The receipt is served at `/operator/transfers/:id/receipt` with its upload content type, `no-store`, and opened by a "View receipt" button in a new tab | The route already exists, so an image can be embedded. A PDF cannot be relied on inline on Android Chrome, so the Receipt preview needs a file card with an open link for PDFs (§8, design work). |

### 4.4 Needs an ADR check before any projection change

| Kit element | Today | Question |
| --- | --- | --- |
| Guest name as the title on home items, the booking detail and the transfer check ("Chidinma Okafor · 2-bedroom apartment…") | Only Booking Request facts carry `primaryGuestName`, and it is optional. `OperatorReservation`, manual transfers, payables and refunds carry no guest name; the booking title is the apartment | Does ADR 0075 (minimise data) with ADR 0082 (representative grants) allow the Operator to see the Guest's name on these records? If not, the kit needs the apartment-first title it already uses as a fallback. **Decision D3.** |
| Amount and stay dates on every home item | `WaitingItem` carries the title, owner, apartment and due time only | The values exist on each source record. Extending the projection is a read-only change, but it touches ADR 0071 (redacted projections), so name the fields in the issue. |
| "Signed in as Tunde, representative for 3 owners" | The session principal is known; the owner count comes from grants (ADR 0082) | Read-only; confirm the wording with the owner. |

### 4.5 Missing states the kit should add

| State | Why |
| --- | --- |
| Receipt deleted after 90 days | The code renders "Deleted after 90 days" (`RECEIPT_RETENTION_DAYS`, ADR 0090). An old declined or late-credit transfer reaches this state |
| No guest name on file | The fallback title, if D3 keeps names, because `primaryGuestName` is optional |
| PDF receipt | See 4.3 |
| Home item for a request without a reminder, and one at the second reminder | The reminder wording has more than one step (`reminderLabel`) |

## 5. Design-system parity (tokens, type, components)

**Tokens.** The kit and the brand use brand names; the code uses semantic names, which AGENTS.md requires ("semantic tokens only"). The implementation issue (brand open decision 1) needs this mapping, keeping the code's names and changing their values:

| Brand token (kit) | Code token | Light: brand / code today | Dark: brand / code today |
| --- | --- | --- | --- |
| `canvas` | `--color-canvas` | `#f8f5ef` / `#F6F5F0` | `#0c0f17` / `#111814` |
| `surface` | `--color-surface` | `#ffffff` / `#FFFFFF` | `#141822` / `#18211C` |
| `surface-subtle` | `--color-surface-subtle` | `#ede9e1` / `#EEECE5` | `#1d212c` / `#212C26` |
| `ink` | `--color-text` | `#181e2c` / `#1D2923` | `#efebe2` / `#E6EBE5` |
| `ink-secondary` | `--color-text-secondary` | `#464d5e` / `#49574E` | `#cecac2` / `#C3CCC5` |
| `ink-muted` | `--color-text-muted` | `#5d6372` / `#5D6A62` | `#a7abb5` / `#A3AFA7` |
| `border`, `border-subtle` | `--color-border`, `--color-border-subtle` | `#757a87`, `#d8d4cc` / `#747C75`, `#D9D6CC` | `#6f7481`, `#2e333d` / `#6B776F`, `#323E37` |
| `indigo`, `-hover`, `-pressed` | `--color-action`, `-hover`, `-pressed` | `#283f92` / `#0B5C46` (green) | `#9cb5f8` / `#5CC49A` |
| `on-indigo` | `--color-on-action` | `#ffffff` / `#FFFFFF` | `#0a1023` / `#06150F` |
| `indigo-subtle` | `--color-action-subtle` | `#e8eefe` / `#EEF6F2` | `#1c253f` / `#15342A` |
| `indigo-deep`, `on-indigo-deep` | `--color-surface-inverse`, `--color-text-on-inverse` | `#111e47`, `#f8f5ee` / `#063A2C`, `#FFFFFF` | `#162146`, `#efebe2` / `#0E2A21`, `#E6EBE5` |
| `sand` | `--color-accent-on-inverse` | `#ebcc99` / `#5CC49A` | `#ebcc99` / `#5CC49A` |
| `sand-ink` | **new** (no code token) | `#815b1f` | `#ebcc99` |
| `focus` | `--color-focus` | `#995600` / `#995300` | `#f0a556` / `#F2A554` |
| `success`, `warning`, `danger` (+ `-surface`) | same names | brand values | brand values |
| `stays-accent`, `stays-subtle` | today `--color-accent`, `--color-accent-subtle` (clay `#8A4318`); per the brand, **`--mode-accent`, `--mode-subtle` under `[data-mode=stays]`** | `#934319`, `#fee5db` | `#eda382`, `#372016` |

The code has `--color-*-border` and `--color-info*` tokens that the brand does not define. The implementation issue must derive them, not invent them, and record how.

**Type.** The brand chooses Newsreader (display, money) and Hanken Grotesk (text), as Google-hosted faces with no files (`tokens.json` `fonts: []`). The code uses system fonts. This is brand-approved, not a deviation, but it has a cost under the slow-network contract (guideline §12, ADR 0078). Self-host subsetted WOFF2 files with `font-display: swap` and system fallbacks, and measure the first render on the reference low-end Android phone before shipping.

**Components.** The kit's spec boards name the components below. None has a drawn or specified source. For each one, the front-end team needs anatomy, variants, every state (idle, focus, busy, success, invalid, disabled, stale), tokens used, its accessible name and role, and the existing code class it maps to:

| Kit component | Likely code home | Status |
| --- | --- | --- |
| Side navigation | `back-office-view.ts` nav | Exists (labels differ, §6) |
| Queue item, Deadline, Tag (Overdue), Status word | `.bo-waiting__item`, `.ui-status` | Exists in part |
| Facts list, Banner, Buttons, Labelled field, Skeleton, Empty | `.ui-facts`, `.ui-banner`, `.ui-button`, `.ui-field`, `.ui-empty` | Exist in the Guest UI kit |
| Disclosure confirm | `.ui-confirm` | Exists |
| Record check-in, Verify a manual transfer | back-office forms | Exist as markup, not as named components |
| Breadcrumb | — | New to the back office |
| Receipt preview | — | **New; flagged by the designer, not designed** |

Operator screens are server pages built from the back-office kit, not A2UI Surface Components (the designer notes this too), so ADR 0108's shared library does not govern them. The guest groups 1 and 2 do touch chat, so their components must follow ADR 0108.

## 6. Copy: what needs the owner's word

The copy board labels each string New (the designer's), Code, or Brief. **Brief strings came from my design prompt, not from the code or the Language page**, so they carry no more authority than New strings. The default is the code's wording unless the owner approves a change.

| Where | Code says | Kit says | Recommendation |
| --- | --- | --- | --- |
| Home title | "Home" (page), summary "N items are waiting on you, soonest deadline first." | "Needs your action" | Owner choice; either passes the trunk test |
| Home empty | "Nothing is waiting on you" / "New Booking Requests appear here as soon as a Guest sends one." | "Nothing needs you right now" / longer line | Keep the code's line unless the owner prefers the kit's |
| Transfer confirm | "Confirm payment" | "Confirm credit" | **Keep "Confirm payment"**: it is the code's word and the Guest-side term. "Credit" stays in the helper text |
| Transfer reject | "Decline this transfer…" | "Reject this transfer" / "Reject transfer" | **Keep "Decline"**: it matches the Operator's request decline and the guideline's state vocabulary |
| Nav | "Payouts" (`back-office-view.ts`) | "Owner payouts" | Owner choice. The designer's note says the code reads "Owner payables"; it reads "Payouts" |
| All strings marked New | — | about 40 strings | Owner review, using the copy board as the checklist |

**The designer's two open questions, answered as the brief's author:**
1. "Safe choice least prominent": their reading is right. Confirm is the one primary action; Decline sits behind a closed disclosure, because a wrong decline releases the dates; late credit appears only after a decline or an expiry.
2. Items with no deadline sort last, oldest first. That is right, and §4.2 gives the change it needs.

## 7. Corrections to the surface plan made in this pass

- §5.2 Home and §8 item 3 asked for the home list to be sorted by deadline. The code already does this. The real change is the narrower one in §4.2 (items with no deadline last), plus the richer items in §4.4.

## 8. Defined work

### Owner decisions (settled 21 November 2026)

The owner accepted the recommendations below after discussing them.

| # | Decision | Settled as |
| --- | --- | --- |
| D1 | Does the kit cover the existing guest journey in the Xenia palette? | **Partly.** After the component layer, the design session redraws only the four screens where the palette changes more than colour: stay card, stay ticket with the money band, Conditional Offer, and Reservation confirmed. The other guest screens follow the token mapping in §5 and are checked in captures. |
| D2 | Where does the kit's source of truth live? | **The brand design system artifact** (<https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d>, components under `project/components/`). The repo keeps the written specs (this audit, the surface plan) and a pointer. The 6 MB export is not committed. |
| D3 | Guest names on Operator records | **Apartment and stay dates as the title** (for example "2-bedroom, Admiralty Way · 3–6 Dec"). The product never collects a guest name: sign-in is email and code (ADR 0093), and staging records every guest as "Guest" (`apps/cloudflare/src/shortlet-pilot-do.ts`). Collecting names is a separate question, probably tied to check-in identity (ADR 0085). |
| D4 | Operator copy | **"Decline"** (not "Reject"), and **"Owner payouts"** in the nav (a code change from "Payouts"). For the confirm button, the code's **"Confirm payment"** stays until the owner chooses "Confirm credit"; the helper text says "credit". All New strings go to owner review. |

### Design work (the next round for the design session)

1. **The component layer.** Publish each component the boards use as a component in the brand design system, following §5's checklist. Start with the ones the boards rely on most: Queue item, Facts list, Disclosure confirm, Banner, Status word, Button, Labelled field.
2. **Receipt preview**, including image, PDF file card, deleted-after-90-days and loading states.
3. **Guest groups 1–3**: Your stays, the period card in chat, and Active Hours on review, to the same standard as the Operator boards.
4. **The missing Operator states** in §4.5, and a compact navigation below 768px (§3, R4).
5. **If D1 is yes:** the existing guest journey in the Xenia palette, from the guest UI canvas.

### Engineering work (after D1–D4; each becomes an issue under `.scratch/ux-guidelines/issues/`)

| # | Work | Bucket | Blocked by |
| --- | --- | --- | --- |
| E1 | Adire Indigo in `shortlet-foundations.css`, using the §5 mapping, the `--mode-*` block, contrast tests and fresh captures (brand open decision 1) | Tokens | none |
| E2 | Self-hosted Newsreader and Hanken Grotesk subsets, with a measured first render on a slow network | Type | E1 |
| E3 | Home: items with no deadline last, overdue tag, time left | View only | none |
| E4 | `GET /operator/transfers/:id` side-by-side page, with the receipt preview and its states | New read route | Design 2 |
| E5 | Booking detail: action panel grouping, effect text, in-page refund step | View only | D4 |
| E6 | Home items with amounts and stay dates; guest names only if D3 allows | Projection | D3 |
| E7 | Your stays, the period card in chat, and Active Hours on review | Per surface plan §8 | Design 3 |
| E8 | Compact back-office navigation below 768px | View only | Design 4 |

Each UI issue ends with the captures and reflow checks in AGENTS.md ("Guest UI work"). Operator screens use the same widths.

## 9. Prompt for the design workspace (next round)

Paste the block below into the Claude design workspace that holds the kit.

```text
Next round for the Xenia kit. The three Operator boards (home by deadline, booking detail with the action panel, transfer check side by side) are accepted for fidelity and backend accuracy. This round turns the boards into a real component kit, applies the owner's decisions, and adds the screens that are still missing. Work in the order below and finish each part before starting the next.

WHERE THE KIT LIVES
The source of truth is the Xenia design system: https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d. Read project/README.md, tokens.json, voice.md, colour.md and open-decisions.md first. Components go under project/components/<Name>/ (README.md plus preview.html), and the design system's own instructions say how. Boards stay as screens and use those components by name. Use only the existing tokens; do not add or change a token. If a component needs one, list it under "Token needed" with the reason.

OWNER DECISIONS (settled 21 Nov 2026), apply them everywhere
1. Guest names: the product never collects a guest's name. Sign-in is email and a code, and every guest is recorded as "Guest". So no Operator screen may show a guest's name. Title each record by apartment and stay dates, e.g. "2-bedroom apartment, Admiralty Way · Thu 3 Dec to Sun 6 Dec". Breadcrumbs use the apartment: "Transfers / 2-bedroom apartment, Admiralty Way". Effect text says "the Guest", never a name: "Makes the Reservation and tells the Guest it is confirmed." The guest phone stays on the booking detail; it is real data. Rework the three Operator boards to this rule.
2. Copy:
   - "Decline", never "Reject": "Decline this transfer…" (disclosure) and "Decline transfer" (button). Reasons: "Not received", "Amount doesn't match".
   - The confirm button reads "Confirm payment". The helper text keeps "credit": "Confirm only after you see the matching credit in the business account. The receipt alone is not proof of payment."
   - Navigation: Home · Requests · Bookings · Transfers · Owner payouts · Calendar.
   - Keep marking every string you wrote as New on the copy board for owner review.
3. Your earlier questions: Confirm stays the one primary action and Decline stays behind a closed disclosure. Items with no deadline (refunds, over-payments) sort last, oldest first. Both of your readings were right.

PART 1. THE COMPONENT LAYER
Publish each component the boards use as a design system component:
Button (primary, quiet, secondary, block, small), Labelled field (with hint and error), Banner (neutral, info, success, warning, danger), Status word, Tag (Overdue), Deadline (absolute WAT time, time left, overdue), Facts list (stacked and two-column), Queue item, Side navigation (and its compact form, Part 3), Breadcrumb, Disclosure confirm, Record check-in, Verify a manual transfer, Skeleton, Empty state.
For each one: a first-sentence summary; anatomy; variants; every state (idle, hover, focus, busy, success, invalid, disabled, stale); the tokens it uses; its accessible name and role and its keyboard behaviour; minimum 44px targets; light and dark previews; and the existing code class it maps to where one exists (.ui-button, .ui-field, .ui-banner, .ui-status, .ui-facts, .ui-confirm, .ui-empty, .bo-waiting__item). Rules: money never uses ink-muted or meta text; danger is for declines and failures only; warning for deadlines and holds, always with a clock icon and an absolute time; colour is never the only signal.

PART 2. RECEIPT PREVIEW (new component)
It shows the Guest's uploaded receipt inline on the transfer check, at a readable size, with an "Illustration" or file-type label and "Open the receipt full size". The backend serves the upload with its own content type and no caching. States:
- image receipt;
- PDF receipt, as a file card with the file name, its size and "Open the receipt", because Android Chrome won't show a PDF inline;
- "Deleted after 90 days" (the retention rule), with no open link;
- loading;
- failed to load, with a retry.

PART 3. MISSING OPERATOR STATES
- Compact navigation below 768px, so the page title stays above the fold at 320px. The wrapped tab rows are not acceptable.
- Transfer check: the receipt deleted after 90 days, on an old declined transfer.
- Home: a Booking Request item with no reminder, one at the first reminder and one at the second.
- Fix the 320px bank transaction reference field so the placeholder isn't cut off: shorten it or rely on the hint.
- Redraw the three Operator boards with the decisions above: titles, copy and navigation.

PART 4. GUEST SCREENS
4a. Your stays (new). A list for the returning guest at /account/stays, plus a matching chat card.
- One card per stay: apartment name, area, dates, the current step as a status word, and the next action with its deadline. Examples: "Offer ready · Accept by 4:00 PM WAT", "Booking Request sent · Waiting for the Operator", "Reservation confirmed · Arrival steps".
- Order: needs action, then upcoming, then past or ended (muted).
- A card opens that stay's existing screen.
- States: several stays across stages, one stay, empty ("No stays yet" with "Find a stay"), signed out (sign in, then return here), loading, error.
- Entry points: the app bar's account action, a "Your stays" link on the Account page, and the "still active" banner.
4b. Extended-stay period card in chat (new). A read-only card for a monthly stay: the next period due with its amount and due date, the periods paid so far, and one action, "Pay this period", which opens the existing period payment page. States: due soon, paid, overdue (with its consequence written out), every period paid.
4c. Review request with Operator Active Hours (change). Add a calm notice near "Submit Booking Request": requests can be sent from 8:00 AM to 7:30 PM WAT, and by 10:55 AM WAT on the check-in date. States: inside the window (an information note); outside the window (the button is disabled and says when sending opens again, and the draft is kept).
Guest rules: the journey rail is Search · Stay · Request · Offer · Pay · Confirmed. Use these terms exactly: Booking Request, Conditional Offer, Reservation, Operator, All-In Stay Total, Refundable Security Deposit. Amount labels: "Total to complete booking", "This payment", "Stay payment paid". The persona label is "Concierge · Stays". Where chat is involved (4a's card, 4b), compose from existing components; any new chat component must be a shared component, not a one-off.

PART 5. FOUR GUEST SCREENS IN THE XENIA PALETTE
The other guest screens will move to Adire Indigo through the tokens alone. Redraw only these four, where the change is more than colour:
- the stay card (search results);
- the stay ticket with the money band on indigo-deep (apartment detail and review);
- the Conditional Offer, live and expired, with its WAT countdown;
- Reservation confirmed.
Use the current screens on https://claude.ai/artifact/TKQCWTF4SWNscKrjLkN1zX as the content source. Keep their facts, order and copy; change only the visual language.

FOR EVERY SCREEN
- 320, 390, 768 and 1280 wide; light and dark; no horizontal scroll; targets 44px or more.
- Every state: loading, empty, error (problem → effect → next action), and stale or expired where relevant. No modal for information.
- Synthetic data only: Lagos and Abuja apartments, phone +234 801 234 5678, labelled illustrations instead of photos.
- A spec board per group: screen type, primary action, components used by name, focus order, states.
- A copy board per group: every string with its source (Code, Brand/Language page, or New).

DELIVER
The components published in the design system; the updated and new boards; one list of "Token needed" and "Copy for review"; and a short note of anything you could not do and why.
```
