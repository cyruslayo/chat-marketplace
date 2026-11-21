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

### Owner decisions (before engineering starts)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Does "high-fidelity kit" cover the existing guest journey in the Xenia palette, or only the six groups in the brief? | Yes, cover it: the front-end team cannot rebrand the guest screens from a green canvas without guessing. Do it after the component layer, as one pass over the guest UI canvas |
| D2 | Where does the kit's source of truth live? | The brand design system artifact (components under `project/components/`), with the boards as a separate artifact linked from it. Do not commit the 6 MB export to the repo |
| D3 | Guest names on Operator records (§4.4) | Check ADR 0075 and 0082 first; until then, design apartment-first titles |
| D4 | The copy rows in §6 | Code wording by default |

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

## 9. Prompt for the design session's next round

> The Operator boards (home, booking detail, transfer check) are accepted for fidelity and backend accuracy. Next round, in this order:
>
> 1. **Components first.** Publish every component the boards use as a component in the Xenia design system (https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d, under `project/components/`). That means Side navigation, Queue item, Deadline, Tag, Status word, Facts list, Banner, Button, Labelled field, Disclosure confirm, Skeleton, Empty, Breadcrumb, Record check-in and Verify a manual transfer. Give each its anatomy, variants, every state (idle, focus, busy, success, invalid, disabled, stale), the tokens it uses, its accessible name and role, and a preview.
> 2. **Receipt preview**: image receipt; PDF receipt as a file card with "Open the receipt" (Android Chrome won't show PDFs inline); "Deleted after 90 days"; loading.
> 3. **Missing Operator states**: receipt deleted; a record with no guest name, using the apartment as the title; a home item with no reminder and one at the second reminder; and a compact navigation below 768px, so the page title stays above the fold at 320px.
> 4. **Guest groups 1–3** from the first brief: Your stays, the extended-stay period card in chat, and Review request with Operator Active Hours. Same standard: four widths, light and dark, every state, a spec board and a copy board.
> 5. **Copy.** Use the code's words where they exist: "Confirm payment", "Decline this transfer…", "Payouts". Keep marking every new string for review.
>
> Your two questions: Decline stays behind a closed disclosure with Confirm as the one primary action, and items with no deadline sort last, oldest first. Both readings were right.
