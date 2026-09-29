# A stable presentation contract between the A2UI builders and the chat organizers

Status: ready-for-agent
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
