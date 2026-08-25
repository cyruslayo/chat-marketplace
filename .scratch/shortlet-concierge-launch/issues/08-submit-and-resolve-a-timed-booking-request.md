# Submit and resolve a timed Booking Request

Status: resolved
Type: AFK
User stories: 13, 18, 20–23, 71–72

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Turn a Request Draft into one disclosed Booking Request only when stay length, Booking Horizon, Operator Active Hours, Latest Disclosure Cutoff, identity, quote, and availability rules pass. Deliver it within five minutes, block inventory for 30 minutes, and let the Operator confirm or decline through structured actions.

## Acceptance criteria

- [x] Drafts do not block inventory; successfully disclosed requests do so exclusively for the defined window.
- [x] Disclosure enforces one-to-fourteen nights, the 90-day horizon, active hours, and safe cutoff.
- [x] Technical delivery, Operator response, expiry, confirmation, and decline are distinct auditable events.
- [x] Agent, conventional web, and permitted Operator interfaces produce the same Platform Command Envelope and outcome.

## Completion note

Issue 08 is implemented with one authoritative timed Booking Request lifecycle from Request Draft through disclosure, technical delivery, Operator response, expiry, confirmation, decline, and delivery failure. Drafts remain non-blocking, while successful disclosure enforces the stay, Booking Horizon, Operator Active Hours, Latest Disclosure Cutoff, identity, quote, and authoritative availability rules before creating the exclusive 30-minute inventory block.

Guest, conventional-web, Weaver, and permitted Operator paths now share the same trusted Booking Request application boundary and PlatformCommandEnvelope semantics. A canonical minimized Booking Request InteractionArtifact projects authoritative lifecycle state and deadlines to deterministic Weaver A2UI v0.9.1 Basic Catalog surfaces, while consequential actions are resolved server-side with authenticated principal, tenant, and Operator authority. Pre-delivery Operator decisions and stale/replayed surface actions fail closed, and restricted identity evidence remains outside ordinary interaction/A2UI state.

Validation: 339 tests passed, 0 failed; focused Issue 08 tests, TypeScript checks, Weaver verification, and final code review passed.

## Blocked by

- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
