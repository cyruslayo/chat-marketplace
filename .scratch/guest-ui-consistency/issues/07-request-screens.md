# Request screens: draft, review, sent, not accepted

Status: resolved
Type: task
Blocked by: 03, 04
Requested: 29 Sept 2026

## Why

The request stage has four states. Each renders in the chat workspace (the request-draft and booking-request surfaces) and as a conventional page (`/booking-requests/drafts/:id`, `/booking-requests/:id`, via `renderConventionalBookingHtml`). The design (`design/RequestDraft`, `RequestReview`, `RequestSent`, `RequestOutcome`) gives all four one layout.

## What to build

For each state, in both the chat workspace and the conventional page:
- **Head:** eyebrow "Booking Request", serif title, a status pill with the domain's status text (for example "Not sent yet · your dates are not reserved", "Waiting for …").
- **Stay ticket** (issue 02).
- **Price breakdown**, with the "If your request is accepted" condition tag and the amount-due line, in the states where it exists today (d2dfced's `amountDueNowIsConditional` flag).
- **"What happens next"** as `.ui-steps`. The step text comes from the existing copy (`guestWaitingGuidance` and the request-pending lines in `guest-content.ts`, and the draft fallbacks). The design's step wording is illustrative; don't add new promises. If a step has no source copy, ask.
- **Draft:** a "Who's staying" card (guests; self-booking attestation from the draft), "Change dates or guests", and the action bar with "Review request".
- **Review:** the action bar with "Send request".
- **Sent:** a neutral banner saying nothing is payable yet, then "Back to your conversation". The request-pending waiting panel becomes this banner plus the steps (no info-blue box).
- **Not accepted** (declined or expired outcomes): the rail's failed step (issue 03), a neutral banner, "Find other stays" and "Back to your conversation".

## Acceptance criteria

- AC1: Each of the four states renders the same head, ticket, breakdown and actions in the chat workspace and on its conventional page. One parity test per state.
- AC2: Before acceptance, the breakdown carries the "If your request is accepted" tag, and it never does on an offer or later screen (extend the d2dfced test).
- AC3: The request-pending chat state shows the neutral banner and steps, and no longer renders `.waiting-panel` (update `guest-waiting-states-chromium.test.ts`).
- AC4: A declined or expired request shows the failed rail step and both actions. "Find other stays" keeps the Guest's criteria (existing behaviour, asserted).
- AC5: Without JavaScript, each conventional request page renders fully and its primary action works (form post), as today.

## ADR compliance

0006 (provider named only where the contract can form), 0015, 0072, 0078, 0080.

## Comments

### Implementation constraints (30 Sept 2026)

| ADR | Constraint | Acceptance criterion / path |
|---|---|---|
| 0005, 0006 | A request is not a Reservation; name the accommodation provider on review/sent | AC1, shared request content |
| 0012 | Display the stored self-booking attestation, never infer it from conversation | AC1, draft guests card and artifact projection |
| 0015, 0077 | Preserve canonical money values, separate deposit and conditional amount wording | AC1–2, ticket/breakdown |
| 0041 | Resolve expiry using the server clock | AC3–4, current request projection and recovery |
| 0070, 0072, 0074, 0075 | Authenticate/authorize records, reject stale authority, reuse commands, escape content and minimize logs | AC4–5, conventional POST handlers |
| 0073, 0081 | Keep the Basic Catalog and runtime-owned action bindings | AC1, presentation-only chat organizer |
| 0078, 0079 | Accessible reflow/targets and server-authoritative deadline refresh | AC3, countdown and shared layout |
| 0080, 0085 | Native deterministic forms with existing contact requirements and no booking identity-verification gate | AC5, review/submit and navigation POSTs |

The ADR directory and all listed records were read before implementation, along with the Shortlet and Concierge Platform CONTEXT documents.

### Approved copy and visual deviations

- Keep **Submit Booking Request** on review in both surfaces, per the user's 30 Sept decision; the design's “Send request” is illustrative.
- “What happens next” uses existing `guestWaitingCopy("operator-response").outcomes` for review/sent, existing draft fallback and `bookingProgressText` for draft, and existing `guestRequestStatus.detail` for outcomes. No new booking promises or policy values.
- Preserve the existing Request Draft / Review Booking Request / Booking Request / Request declined / Request expired titles, exact projected amounts, provider disclosure, named occupants, cancellation terms and quote disclosures. These make screens longer than the illustrative artboards.
- Draft gains the conditional tag without gaining the review-only amount-due line. Declined/expired keep the historical conditional breakdown; the neutral outcome banner explicitly states that no payment is due/no Reservation was made.
- The chat retains its conversation sheet frame and close control. Request-pending content now uses a neutral banner and kit steps; existing countdown/refetch behavior remains server-authoritative.
- No-JS draft/review primary actions and request navigation are native POST forms. Draft/review pass through the current action handler and platform commands; recovery preserves the stored search criteria.

### Definition of Done review

1. Dedicated named tests cover AC1–AC5 in `test/guest-request-consistency-chromium.test.ts` and `test/guest-request-consistency.test.ts`; four separate parity tests cover the four states.
2. Negative coverage includes the absent waiting panel, absent conditional tag on later screens, declined and exact-deadline expiry outcomes, missing/foreign/cross-origin authority, review bypass, stale/duplicate submissions, and disabled historical draft actions. Native Chromium forms run with JavaScript disabled.
3. The ADR table above was rechecked against implementation: provider disclosure, stored attestation, projected pricing, lazy expiry, ownership/current authority, existing commands, Basic Catalog bindings, escaped content, reflow/targets, authoritative countdown and no-JS/contact parity all remain enforced.
4. No new class or unused constructor dependency was introduced.
5. Domain copy/amounts/policies are sourced as documented above; no new business thresholds or promises.
6. No new audit payload includes credentials or restricted identity/payment material; commands retain the existing minimal transition records. Captures and diagnostics use synthetic local fixture data.
7. `npm run check` passes with zero errors. The final actual `npm test` run exits 0: **1210/1210 non-browser tests**, **151 Chromium passes, 1 pre-existing skip, 0 failures**. `git diff --check` is clean.

## Answer

Implementation committed as `f802424`; resolved after the full-suite and Definition of Done review above.

One shared request-screen layout now renders draft, review, sent and not-accepted states on both surfaces. `apps/web-agent/src/request-presentation.ts` projects shared content; `requestScreenHtml` in `guest-kit.ts` builds the kit markup. The chat uses the same layout around its label-driven ticket/breakdown while retaining Weaver's bound actions and visible loading feedback.

The conventional routes now support native review/submit/navigation POSTs through owner/current-state checks and the existing application commands. Historical drafts remain readable with material actions disabled. Declined/expired recovery keeps the stored search criteria. Request-pending uses the neutral banner and kit steps, with the existing server-authoritative deadline/refetch behavior.

Verification: **1361 passes, 1 pre-existing skip, zero failures** across the full suite; typecheck clean. **40 light captures** in `screenshots/07/` cover draft/review/sent/declined/expired, chat and page, at 320/390/768/1280. Capture checks report no horizontal overflow or controls below 44px. Intentional copy/visual differences are recorded above.
