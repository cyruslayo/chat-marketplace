# Design round 12: missing boards and new components

Status: resolved
Type: task
Blocked by: none. The owner sends the prompt; D13 changes one line of copy

## What to do

Share the prototype with the design team and send [design-prompt-12.md](../design-prompt-12.md). The design system is the source of truth, so code for a new component waits until it is published there.

## Acceptance criteria

- AC1: The six new components are published in the design system with states, tokens and accessibility.
- AC2: A board, or a written "keep as is", exists for each screen in the prompt's part 2.
- AC3: The two kit defects are fixed in `bundle.css`.
- AC4: Every new string is listed with its source for the owner.

## Comments

### Verification against round-12 delivery (26 Nov 2026)

Pinned artifacts stored under [design/round-12/](../design/round-12/README.md) from the 5 owner-exported HTML board bundles (`Main.dc.html`..`CopyReview.dc.html`, `tokens.css`, `xenia-kit.css`, `bundle.css`).

#### Acceptance criteria verdict

| Criterion | Status | Evidence |
| --- | --- | --- |
| AC1: Six new components (+ multi-domain components) | **Met (in `bundle.css` & boards; standalone component READMEs not in HTML exports)** | `bundle.css` + boards implement all 6 new guest components with tokens, states, ARIA roles/attributes, and >=44px targets: **Tab bar** (`.ui-tabbar`, `.ui-badge` on `warning-surface` + `.ui-visually-hidden`, 56px min-height, `aria-current="page"`, 3 non-wrapping columns at 320px), **Ask bar** (`.ui-ask` + `.ui-composer--link`), **Task bar** (`.ui-appbar--task`, 44px Close + centered title + 44px Help, no wordmark/tab bar), **View switch** (`.ui-segmented` link/radio variants, 44px targets), **List row** (`.ui-list` / `.ui-list__row`, 56px min-height, primary/secondary/aside/chevron), **Side navigation, guest** (`.ui-sidenav--guest`, current in ink, badge, end-list divider). Also in `bundle.css` & `Domains.dc.html`: **Concierge chooser** (`.ui-chooser`, `.ui-chooser--dialog` inside `.ui-dialog`), **Domain tag** (`.ui-domain-tag`), **Switch divider** (`.ui-switch-divider`). Follow-up: pin standalone `project/components/*/README.md` from `XH7yVkfLzKG357Gxqc1F3d` when accessible. |
| AC2: Board or written "keep as is" for every screen in prompt part 2 | **Met** | Covered across the 24 pinned boards and `Handover.dc.html` "Keep as is" table: `Apartment.dc.html` (gallery & photo viewer), `Compare.dc.html`, `PaymentChoice.dc.html`, `BankTransfer.dc.html`, `ManualTransfer.dc.html`, `Outcomes.dc.html` (declined/expired/stale), `SignIn.dc.html`, `Account.dc.html`, `StayBefore.dc.html`, `StayDuring.dc.html`, `StayAfter.dc.html`, `Payments.dc.html`, `Report.dc.html`, `Change.dc.html`, `Cancel.dc.html`, `Message.dc.html`, `Help.dc.html`, `Saved.dc.html`, `Unavailable.dc.html`, `TaskRail.dc.html`. `Handover.dc.html` records "Keep as is" for Find (start/results/list), Review request, Waiting for the Operator, Conditional Booking Offer, Reservation confirmed, Your stays / No stays yet, Hosted card checkout (Paystack), and Guest demo frames. |
| AC3: Two kit defects fixed in `bundle.css` | **Met** | `bundle.css` (lines 243, 310–311, 355–356): `.ui-stay-card__title` now `min-height:44px;margin-block:-6px` (was 26px); `.ui-persona--human .ui-persona__mark` now `width:24px;height:24px;font:700 12px/1 var(--font-sans)` (was 18px with 10px text). Verified in `Main.dc.html`. |
| Prompt part 4: App bar at 320px & short phones | **Met** | `bundle.css` lines 365–371 & 466–472 and `Main.dc.html`: at `max-width:23rem` Back hides the wordmark (`.ui-appbar__action+.ui-appbar__brand{display:none}`); at `max-width:26rem` `.ui-mode-label__prefix` hides; `.ui-page--short` / `@media (max-height:37.49rem)` trims bar heights while keeping >=44px targets. Measured in Chrome on `Main.dc.html`: 320x640 gives 461px content (72.0%), 320x568 gives 416px content (73.2%), "Your stays" measures 66px in a 106px column, no wrap, no target <44px. |
| AC4: Copy list with source for the owner | **Met** | `CopyReview.dc.html` consolidates 63 New/Brand entries grouped by decision/section, and each product/shell board carries its own `Code` / `Brand` / `New` copy list. Extracted and checked against `guest-content.ts` in [copy-decisions.md](../design/round-12/copy-decisions.md). |

#### Open items from `Handover.dc.html` (recorded as follow-ups, NOT met)

1. **4 Token needs (none added to `tokens.json` / `tokens.css` yet; proposed in issue 07 without adding unapproved tokens):**
   - Scrim colour for dialogs and the photo viewer (currently `indigo-deep` at 60% opacity on `::backdrop` and solid `indigo-deep` in viewer).
   - A `14/20 600` strong small text style (used by tab labels, chooser options, list values, and status words; `tokens.json` only has `small` 400 and `label` 16/20 600).
   - A `15/20 600` action label decision (shipped App bar actions, side nav links, and chips use 15px; Handover recommends moving them to `label` 16/20).
   - A badge/count radius token (`radius-sm` used to keep `radius-pill` for chips and pill actions).
2. **4 "Not components yet" board layouts (in `xenia-kit.css`, next components to publish):**
   - Photo viewer and gallery (`.xk-gallery`, `.xk-viewer`)
   - Comparison table (`.xk-compare`)
   - Upload field (`.ui-upload` in code, board layout on `ManualTransfer.dc.html`)
   - Next-payment panel (`StayDuring.dc.html`, `Payments.dc.html`)
3. **Agent Marks from design system:** Design system has no mark component/asset yet; `Domains.dc.html` / `bundle.css` use static outline stills from the playground rig (animated states not drawn).
4. **Canvas boards not rendered or screenshotted:** Only the components and shell (`Main.dc.html`) were measured in Chrome; the 22 screen boards themselves were not rendered or screenshotted (capture checks remain part of Phase 2b ports).
5. **Owner-blocked placeholders ("Set by the owner"):** Support phone, WhatsApp, and hours (D6), full address & access timing (D7), report handling/rota (D18), manual-transfer bank details (ADR 0090 config), receipt document fields (D19), refund wording (D20), and review scale.
6. **Pin remaining artifact-only metadata:** Pin standalone `project/components/*/README.md`, raw `project/tokens.json`, and `project/canvas.json` if/when `XH7yVkfLzKG357Gxqc1F3d` and `3SJdAGNjUAKt4Um228zZgB` are exported directly via the `Artifact` tool.
