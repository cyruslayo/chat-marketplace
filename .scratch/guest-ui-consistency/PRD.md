# PRD: One consistent guest UI (implement the "Guest UI consistency" design)

Status: ready-for-agent
Requested: 29 Sept 2026
Design approved by the user: 29 Sept 2026

## Problem

The guest app looks like two different products:

- **The chat workspace** shows each booking moment through Weaver/A2UI surfaces. `apps/local-guest/src/client.ts` then rearranges them by matching their text (`organizeBookingTicket`, `decorateDiscoveryCards`, `organizeUnitDetail`). Anything the text match misses keeps Weaver's default look. The payment deadline is a blue info box (`.waiting-panel`, fed by `guestWaitingGuidance` in `apps/web-agent/src/guest-content.ts`).
- **The standalone pages** are server-rendered by `apps/local-guest/src/guest-server.ts`: `renderConventionalBookingHtml`, `renderConventionalSearchHtml`, `renderConventionalUnitDetailHtml`, `renderTransferPageHtml`, `renderManualTransferPageHtml`, the payment page in the `/payments/offers/:id` handler, `renderNoScriptConversationHtml`, and `errorPage` in `apps/web/src/ui-kit.ts`. They use the green stay ticket and price breakdown, but have no top bar or journey rail, and differ in detail.
- The chat shell (`renderGuestShellHtml`) defines its own colour variables (`--accent`, `--surface`, `--border`) and its own rail styles beside the shared foundations.

## Goal

Every guest screen, whether in the chat workspace, as a standalone page, on a phone or on desktop, in light or dark, is built from **one component kit** and looks like the approved design.

## The design (source of truth)

- **Canvas (live):** https://claude.ai/artifact/TKQCWTF4SWNscKrjLkN1zX, titled "Guest UI consistency". Read it with the Artifact tool (`action: "read"`).
- **Local copy (use this in code work):** `.scratch/guest-ui-consistency/design/`
  - `kit.css`: every component, with the light and dark tokens copied from `apps/web/src/shortlet-foundations.css`
  - `Main.dc.html`: the component kit sheet
  - one `*.dc.html` per screen: `ChatHome`, `ChatResults`, `Compare`, `Search`, `UnitDetail`, `RequestDraft`, `RequestReview`, `RequestSent`, `RequestOutcome`, `Offer`, `OfferExpired`, `PaymentChoice`, `CardHandoff`, `BankTransfer`, `ManualTransfer`, `PaymentWaiting`, `NoReservation`, `Confirmed`, `ErrorPage`, `NoJsConversation`, and the four `Desktop*` split views
  - `renders/*.png`: each artboard rendered in light and dark. Compare your screenshots against these.
  - `check.mts`: re-renders the artboards (`npx tsx .scratch/guest-ui-consistency/design/check.mts`)
- The `.dc.html` files are plain HTML plus `{{theme}}`. Open one in a browser and it renders with `kit.css`.
- Background: `.scratch/ui-editorial-refinement/PLAN.md` and `mockups.html` (the approved mood), and `docs/design/shortlet-design-system-direction.md`.

## Kit → foundations mapping

The kit is implemented **once**, as `ui-*` classes in `apps/web/src/shortlet-foundations.css`. Do not ship `kit.css`. Class names on the left are the design's; on the right, what they become. Reuse an existing class where there is one.

| Design (`kit.css`) | Implement as | Exists today? |
|---|---|---|
| `.topbar`, `.brand`, `.iconbtn`, `.textbtn` | `.ui-appbar`, `.ui-appbar__brand`, `.ui-icon-button`, `.ui-button--small` pill | no (the chat header is shell-local) |
| `.rail li.done/.now` | `.ui-rail` with `li[data-state="done|current|failed|upcoming"]` (keep `JourneyStepState` from `journey-rail.ts`) | shell-local `#journey-rail` |
| `.chip`, `.chip.add`, `.chip.on`, `.fact` | `.ui-chip`, `.ui-chip--add` (dashed), `.ui-chip[aria-pressed=true]`, `.ui-fact` | `.ui-chip` yes; the rest no |
| `.me`, `.bot`, `.who`, `.marker`, `.composer`, `.send` | the chat shell's bubbles and composer, restyled with foundation tokens | shell-local |
| `.stay`, `.total`, `.money`, `.more` | `.ui-stay-card` (+ `__where`, `__title`, `__total`) | the chat has `.stay-card*`; search has its own |
| `.result`, `.thumb` | `.ui-result-row` | no |
| `.hero`, `.sheet`, `.tiles`, `.tile`, `.actionbar` | `.unit-detail-*` + `.ui-tiles` + `.ui-action-bar` | partly (48831b0) |
| `.ticket` (`.lab`, `.name`, `.dates`, `.day`, `.date`, `.arrow`, `.foot`) | `.ui-ticket` + BEM parts; add the Check-in/Check-out labels and foot line | `.ui-ticket` yes, simpler |
| `.breakdown`, `.row`, `.due`, `.paid`, `.cond` | `.ui-price-breakdown` + `__row`, `__due`, `__paid`, `__condition` | partly |
| `.banner.warn/.ok/.bad/.note` | `.ui-banner--warning/--success/--danger/--neutral` | yes (add neutral) |
| `.status(.ok/.wait/.bad)` | `.ui-status--success/--warning/--danger/--neutral` pill tags | yes |
| `.steps` | `.ui-steps` (numbered "what happens next") | no. It replaces `.waiting-panel` |
| `.seg` | `.ui-segmented` (a no-JS radio group, see issue 09) | no |
| `.facts`, `.acct`, `.copyrow`, `.copied`, `.upload` | `.ui-facts--stacked`, `.transfer-account`, `.transfer-copy*`, `.ui-upload` | partly |
| `.btn`, `.btn.alt`, `.link` | `.ui-button--primary/--secondary` (pill in `.guest-editorial`), `.ui-link` | yes |
| `.compare` | the chat's compare rows, restyled | shell-local |
| `.empty` | `.ui-empty` | yes |
| `.split`, `.work .inner` | the chat shell's desktop split; workspace reading width 560px | shell-local |

Tokens already exist and match the design exactly (`--color-surface-inverse`, `--color-text-on-inverse(-muted)`, `--color-accent-on-inverse`, `--radius-pill`, dark values). **Do not change any existing hex value.**

## Principles every issue follows

1. **One markup source per component.** Server pages get small HTML helpers (a new `apps/local-guest/src/guest-kit.ts`: `appBarHtml`, `railHtml`, `stayTicketHtml`, `priceBreakdownHtml`, `deadlineBannerHtml`, `stepsHtml`, `bankDetailsHtml`, `resultRowHtml`, `stayCardHtml`). Move the existing `renderStayTicketHtml` and `renderPriceBreakdownHtml` there. The chat organizers produce the **same DOM and classes** from Weaver output.
2. **A stable presentation contract, not ad-hoc text matching.**
   - Where a chat organizer must find a fact in Weaver output (check-in, check-out, party, total, deposit, amount line, deadline), the A2UI builders in `apps/web-agent/src/*-a2ui.ts` emit that fact as its own `Text`, with a label prefix taken from one shared constant table in `apps/web-agent/src/guest-content.ts`.
   - `client.ts` matches on those constants only. The Weaver Basic Catalog is unchanged (ADR 0073/0081): no new component types.
3. **The same screen in chat and standalone.** For each screen in the design, the workspace pane and the conventional route render identical structure and copy. Tests assert this parity.
4. **Copy comes from the domain.** Glossary terms come from `GUEST_GLOSSARY`. Amounts, deadlines and times come from the projections. Never type a number or time into markup. The design's placeholders (`[verification deadline]`, `[upload time]`) must be real projection values; if one doesn't exist, ask. Don't invent it.
5. **No-JS parity (ADR 0080).** Every standalone page works with JavaScript off. Scripts only enhance (the `/payment.js` pattern).

## ADR compliance (read these before any issue)

| ADR | Constraint | Where it bites |
|---|---|---|
| 0015 | All-In Stay Total leads; nightly rate secondary and labelled; deposit always separate | stay card, unit detail, breakdown order: total → deposit → amount line |
| 0006 | Name the accommodation provider only where the contract can form | review, sent, offer copy ("Eko Prime Living Ltd, your accommodation provider") |
| 0031 / 0032 | Arrival and checkout times only from the policy projection | the ticket shows times only when the projection has them. The design shows dates only |
| 0066 | No ratings, no "Verified" badge, no price-pin map; neighbourhood-level location | stay card, unit detail |
| 0072 | Client code limited to reversible presentation effects | organizers and `/payment.js` |
| 0073 / 0081 | Weaver Basic Catalog unchanged; styling is CSS plus client arrangement | every chat surface |
| 0075 | No secrets in URLs or logs; photos use no-referrer | result rows, gallery |
| 0078 | WCAG 2.2 AA, 44px targets, 320px reflow, reduced motion, en-NG/₦/WAT, absolute deadlines | every issue |
| 0080 | Deterministic parity; every critical workflow works without JavaScript | every standalone page |
| 0089 / 0090 | Payment amounts as projected; manual bank transfer stays an option | payment issues |

## Open decision (must be answered before issue 09’s copy is final)

"Amount due now" means ₦390,000 (stay + deposit) on the payment choice page, but ₦370,000 (the stay payment alone) on the transfer pages. "Amount paid" on confirmation shows the stay payment only. See issue 12. Until the user decides, keep today's values and labels exactly.

## Out of scope

- After-booking surfaces: amendment, cancellation, check-in support, checkout, deposit claim, relocation, mid-stay failure, conduct, human handoff, pending action. They adopt the kit in a later effort.
- The owner/back-office apps.
- New features or flows. This is presentation only; no domain or command changes.

## Slicing

See `map.md`. Issues are vertical: each leaves the app shippable, and `npm run check` plus `npm test` pass after it.

## Verification for the whole effort

- Per issue: unit tests on the server markup, plus a real-Chromium test where layout or interaction matters (follow the `test/helpers/*` patterns; no duplicated fixtures).
- Visual: `.scratch/guest-ui-consistency/walkthrough.ts` (add it to `.claude/launch.json` as `guest-ui-walkthrough`, ports 3021–3027) and `capture.ts` capture every screen at 320/390/768/1280. Compare them side by side with `design/renders/`. Save the results under `.scratch/guest-ui-consistency/screenshots/<issue>/`.
