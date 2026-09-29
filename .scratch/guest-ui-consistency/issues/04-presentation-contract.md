# A stable presentation contract between the A2UI builders and the chat organizers

Status: resolved
Type: task
Blocked by: 02
Requested: 29 Sept 2026

## Why

The chat can only look like the standalone pages if `client.ts` can reliably find each fact in Weaver's output. Today it guesses with regexes over free text:
- `organizeBookingTicket` matches `/^(?:Stay(?: dates?)?:|(?:Mon|Tue|…)…)/` for the date, and `/^(?:Total to complete booking|Amount Due Now|Amount due now|Amount paid)/i` for the amount line
- `decorateDiscoveryCards` finds the location as "the first `<small>`"

When a builder changes wording, the chat silently falls back to Weaver's default look. That is how the two products drifted.

## What to build

- **Label table.** In `apps/web-agent/src/guest-content.ts`, add one exported, frozen label table for presented facts, for example `GUEST_FACT_LABELS`: check-in, check-out, stay length and party, All-In Stay Total (reuse `GUEST_GLOSSARY`), Refundable Security Deposit (reuse), amount due now, amount paid, next payment, deadline, status, provider.
  - Every label must already exist in the current copy or in `GUEST_GLOSSARY`. Do not invent wording. Where two surfaces use different labels for the same fact (the offer's "Total to complete booking" versus "Amount due now"), use "Amount due now" as the approved design does, and note it in `## Comments`. The *meaning* of that amount is issue 12, so don't change amounts.
- **Builders.** The booking A2UI builders in `apps/web-agent/src/` (`request-draft-a2ui.ts`, `booking-request-a2ui.ts`, `conditional-offer-a2ui.ts`, `card-payment-a2ui.ts`, `bank-transfer-a2ui.ts`, `booking-contract-a2ui.ts`, `discovery-a2ui.ts`, `unit-detail-a2ui.ts`) emit each presented fact as its own `Text` component, starting with its label from the table, in one canonical order: ticket facts, then money facts, then status and actions. Use only Basic Catalog components (ADR 0073/0081).
- **Organizers.** `client.ts`:
  - rewrite `organizeBookingTicket`, `decorateDiscoveryCards`, `organizeUnitDetail` and the surface-kind switch to find facts **only** through the label table (import it; the client bundle already imports `guest-content.ts`)
  - each organizer produces the exact DOM and classes of the matching `guest-kit.ts` helper (issue 02), so the chat and the page render identical structure
  - if a fact is missing, the organizer leaves the surface readable as Weaver rendered it: no half-built ticket (fail safe)
- **Text fallbacks.** Keep every surface's `textFallback` string complete (ADR 0080). The builders' text fallbacks still contain every fact.

## Acceptance criteria

- AC1: Each booking A2UI builder emits the ticket and money facts as separate `Text` components that start with the shared labels, in canonical order. One test per builder.
- AC2: `client.ts` contains no regexes over presented wording for those facts. It finds them through the shared label table only. A test greps the bundle source, or asserts through a real-Chromium render.
- AC3: For the same thread and surface, the workspace's organized DOM and the conventional page's ticket and breakdown have the same structure (classes and order) and the same text. Parity test in real Chromium for request review, offer, payment and confirmed.
- AC4: When a builder omits a fact (for example no quote yet), the organizer builds nothing partial, the Weaver output stays visible, and no error is thrown.
- AC5: Every surface's `textFallback` still contains the All-In Stay Total, the deposit when there is one, the amount line and the deadline when there is one.

## ADR compliance

0073/0081 (Basic Catalog only), 0072 (organizers are reversible presentation only), 0080 (text fallbacks), 0015 (order).

## Comments

## Answer

Landed on `ui/guest-consistency`.

- **Label table.** `GUEST_FACT_LABELS` (frozen) in `apps/web-agent/src/guest-content.ts`, plus `guestFact` and `guestFactValue`: check-in, check-out, stay ("Stay: 3 nights · 2 guests"), stay dates, All-In Stay Total, Refundable Security Deposit (separate), "If your request is accepted", amount due now, amount paid, next payment, guests, fit reason. Every label is existing copy or a glossary term. `booking-presentation.ts` gained `formatTicketDate`, `formatStayFoot`, `nightsBetween`, `ticketFactComponents` and `ticketFactIds`, shared by the builders and by `guest-kit.ts`.
- **Builders (AC1).** Request draft, booking request, conditional offer, card payment, booking contract and bank transfer each emit check-in, check-out and stay as separate label-prefixed `Text`s, then the money facts in the order [condition], All-In Stay Total, deposit, amount line, in canonical position. New facts on the way: the booking request and contract now carry the whole breakdown (they lacked the amount line and the total respectively), and `CardPaymentArtifact` and `BankTransferArtifact` gained an optional `occupantCount` so the payment ticket can show the party. The Basic Catalog is unchanged. Named guests stay visible as a separate `Guests: names` line under the ticket (draft and contract), since the ticket shows only the count, as in the design.
- **Organizers (AC2, AC3, AC4).** `client.ts` `organizeBookingTicket` finds facts only through `guestFactValue(text, GUEST_FACT_LABELS.*)` and replaces them with `ticketHtml` and `breakdownHtml` from `guest-kit.ts`, the same functions the standalone pages use (`stayTicketHtml` and `priceBreakdownHtml` are thin wrappers over them). The kind switch now sends the confirmation (`:booking:`) through the organizer as well. A missing fact builds nothing partial. In `organizeUnitDetail`, the Stay dates line is found by its label, not by excluding other wording.
- **Fallbacks (AC5).** The text fallbacks now say "Amount due now" and "Amount paid", and the request, draft-review and payment fallbacks state the amount line and, for a request, "If your request is accepted".
- **Tests.** `test/guest-presentation-contract.test.ts`: one test per builder for AC1 (six), AC2 (no regex line in the client mentions booking-fact wording; the client does not spell the labels itself), AC5, and a table test. `test/guest-presentation-parity-chromium.test.ts`: AC3 (the ticket and price breakdown in the workspace equal the conventional page's for review, offer, payment and confirmed, HTML-identical after dropping `datetime`) and AC4 (the response is rewritten without Check-out: no ticket, the Weaver text stays visible, the surface is active, nothing announced as an error). Existing assertions changed for the new wording only: `phase4-booking-payment-presentation`, `render-card-payment-weaver-a2ui`, `render-conditional-offer-weaver-a2ui`, `local-guest-weaver-demo`.
- **Verification.** `npm run check` clean; `npm test`: phase 1 1200/1200, phase 2 (real Chrome) 133 pass, 0 fail, 1 skip. Screenshots: `screenshots/04/`.

## Comments

- **Label change (please confirm).** The offer, card payment and draft used "Total to complete booking (if confirmed)" and the contract "Stay payment verified"; the approved design and the standalone pages use "Amount due now" and "Amount paid", so those are now the only labels. Amounts are unchanged; what "Amount due now" and "Amount paid" mean is issue 12.
- **B and H test.** It passed only by accident, because its `not.*confirmed` regex matched "Total to complete booking if confirmed"; it now asserts "Your dates are not reserved".
- **Not in this issue.** `decorateDiscoveryCards` still finds the card location as the first `<small>` (the discovery builder's location has no label; issue 05 redesigns the card and settles it), and `draft-replacement-a2ui` keeps its "Total to complete booking if confirmed" line (issue 07 territory). The bank transfer builder is not surfaced in the chat at all today, so it is tested directly.
- ADRs: 0073/0081 (Basic Catalog only, no new component type), 0072 (the organizer only re-arranges text the server already sent), 0080 (text fallbacks complete), 0015 (total, deposit, amount line order asserted per builder), 0006 (provider line untouched).
