# Confirmation and system pages: confirmed, error pages, conversation without JavaScript

Status: resolved
Type: task
Blocked by: 03, 04
Requested: 29 Sept 2026

## Why

The end of the journey and the edges must look like the same product: the confirmed reservation (chat and `/booking-contracts/:id`), every error page (`errorPage` in `apps/web/src/ui-kit.ts`, used through `sendPageError`), and the server-rendered conversation for browsers without JavaScript (`renderNoScriptConversationHtml`). Designs: `design/Confirmed`, `ErrorPage`, `NoJsConversation`.

## What to build

- **Confirmed:**
  - a success pill "Stay payment verified", then the ticket with the booking reference in the foot
  - the paid breakdown: total, deposit collected, "Amount paid" (today's value; see issue 12)
  - "Before you arrive" as `.ui-steps`, from the existing confirmation copy (check-in details shared later; a confirmed booking doesn't itself grant access; the full contract is in booking details)
  - "Back to your conversation" and "View booking details"
- **Error pages:** `errorPage` renders inside the app bar (no rail: an error isn't a journey step), with the `.ui-empty` card, a pill primary action, and the machine code kept in the markup (`data-error-code`). Applies to every `sendPageError` status.
- **Conversation without JavaScript:** the same app bar, rail, bubbles, markers, result rows for surfaces (their text fallback plus a link to the conventional route) and composer as the chat. The submit is a real "Send" button (issue 06c behaviour unchanged).

## Acceptance criteria

- AC1: The confirmed reservation renders the same ticket, paid breakdown, steps and actions in the chat workspace and on `/booking-contracts/:id`. Parity test.
- AC2: Every error page (400, 401, 403, 404, 409, 500 paths) renders the app bar, the empty-state card and one primary action, and keeps `data-error-code` and `data-status`. One test per status family.
- AC3: The no-JavaScript conversation uses the chat's app bar, rail, bubbles and composer classes, and each surface appears as a result row linking to its conventional route. Real Chromium with JavaScript disabled (extend `guest-no-js-composer-chromium.test.ts`).
- AC4: Without JavaScript, posting a turn from that page still produces a server-rendered reply (the existing 06c test still passes).

## ADR compliance

0078, 0080, 0075 (no identifiers beyond today's in error pages).

## Comments

User decision: show the existing Reservation ID verbatim as the booking reference (30 Sept 2026).

| ADR | Constraint | Acceptance criterion / path |
|---|---|---|
| 0004, 0077, 0081 | Authoritative projections, presentation-only Weaver adapter | AC1, shared confirmation content |
| 0006, 0015, 0016, 0032, 0089 | Provider disclosure, canonical amounts, deposit collected only when held, existing contractual checkout copy | AC1, breakdown and booking details |
| 0022, 0085 | Reservation is distinct from physical-access authority | AC1, arrival guidance |
| 0070, 0072, 0073, 0074, 0075 | Existing identity/command boundaries and approved Basic Catalog, safe fallback, escaped minimized content | AC1–4, links/errors/forms |
| 0078, 0080 | Accessible reflow/targets and deterministic native forms | AC1–4 |

Listed ADRs and the Shortlet/Concierge CONTEXT documents were read before implementation. The approved kit/artboards govern the visual direction.

### Intentional artboard differences

- The booking reference is the actual Reservation ID, as chosen by the user; long identifiers wrap rather than adopting the illustrative `SL-` reference format.
- Today's Amount paid and deposit figures are preserved (issue 12 remains open). A deposit says collected only when the contract projection says held; zero/missing deposits do not create a collected line.
- Three arrival steps are the existing confirmation sentences, split without changing their meaning. Available access continues to direct the Guest to secure booking details; confirmation never grants physical access.
- `View booking details` links to a readable details section on the existing owner-authorized contract route. It retains the existing confirmation summary, provider disclosure, named occupants when supplied, checkout/policy/rule copy and card last-four metadata. This section makes the page longer than the illustrative confirmation artboard.
- No-JS result rows retain complete fallback text, not the shortened sample in the artboard; conversation length depends on the actual timeline. Inputs retain their visible label/help and native validation.
- Error pages use the existing icon/status-family choices and generic recovery copy for previously unmapped error codes. Codes stay in markup; API clients retain JSON.

### Verification in progress

- All **11 issue-10 tests pass**; typecheck and `git diff --check` are clean.
- The full suite's first non-browser phase passed 1217/1218: its one failure was an existing test expecting the old no-JS rail markup. That assertion now checks the shared kit rail; the isolated journey file passes 8/8.
- The first Chromium phase finished with eight outdated mobile confirmation assertions plus the two documented flaky tests. Mobile assertions now check the kit title and success pill; all 43 mobile tests and all five gallery tests pass in isolation. New conversation's Escape test now waits for focused confirmation and the asynchronous keydown result rather than asserting immediately after CDP dispatch; its isolated file passes 2/2.
- The final actual `npm test` rerun exits 0: **1218 non-browser passes, 154 Chromium passes, 1 pre-existing skip, zero failures** (`full-test-10.log`).
- Sixteen light captures are saved in `screenshots/10/` (confirmed page/chat, no-JS conversation, error, at 320/390/768/1280). The final capture run exits 0, with all reflow and 44px checks passing; it waits for fonts before measuring targets. Representative captures were compared with the approved artboards; the money-wrap issue found in that comparison is fixed.

### Definition of Done review

1. Dedicated named tests cover AC1–AC4 in `test/guest-confirmation-system*.test.ts`, including one test per error-status family.
2. Negative checks cover escaped error content, absence of a journey rail on errors, JSON API parity, cross-origin rejection without a request, zero/missing uncollected deposits, absence of due/conditional lines on confirmation and native operation with JavaScript disabled.
3. The ADR table was rechecked against the implementation: authoritative artifacts and existing ownership checks govern confirmation; provider and policy disclosures remain; amounts are unchanged; collected deposits require held state; access stays separate from Reservation; safe kit fallback, escaped content, native forms and accessible targets/reflow remain enforced.
4. No new class or unused injected constructor dependency was introduced.
5. Domain policy/copy comes from the existing confirmation projection/builder and cited ADRs. The user approved the Reservation ID reference; no new ID format or pricing policy was invented.
6. No new logging or audit payload includes bearer credentials or restricted identity/payment material. Captures use synthetic local fixture data.
7. `npm run check` and `git diff --check` are clean. Actual `npm test` exits 0 with **1372 passes, 1 pre-existing skip, zero failures**.

## Answer

Implementation committed as `5b73998`; resolved after the full-suite and Definition of Done review above.

Confirmation now shares one kit layout across the workspace and owner-authorized contract page, including the Reservation ID in the ticket foot, held-deposit-aware paid breakdown, existing arrival sentences as steps and navigation to readable booking details.

Error pages share the app bar and pill recovery action without a rail, retaining machine codes/statuses and JSON for API clients. The no-JavaScript conversation shares kit framing, bubble/receipt/composer classes and native result-row links while preserving complete fallback text and server-rendered POST replies.

Full verification: **1218 non-browser passes + 154 Chromium passes, 1 pre-existing skip, zero failures**; typecheck clean; **16 light captures** at 320/390/768/1280 in `screenshots/10/`, all reflow/44px checks pass. Intentional artboard differences are recorded above. Existing rail/mobile assertions now check kit markup; the New conversation test waits for focus and keydown completion instead of racing CDP.
