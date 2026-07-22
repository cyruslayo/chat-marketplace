# Submit and resolve a timed Booking Request

Status: ready-for-agent
Type: AFK
User stories: 13, 18, 20–23, 71–72

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Turn a Request Draft into one disclosed Booking Request only when stay length, Booking Horizon, Operator Active Hours, Latest Disclosure Cutoff, identity, quote, and availability rules pass. Deliver it within five minutes, block inventory for 30 minutes, and let the Operator confirm or decline through structured actions.

## Acceptance criteria

- [ ] Drafts do not block inventory; successfully disclosed requests do so exclusively for the defined window.
- [ ] Disclosure enforces one-to-fourteen nights, the 90-day horizon, active hours, and safe cutoff.
- [ ] Technical delivery, Operator response, expiry, confirmation, and decline are distinct auditable events.
- [ ] Agent, conventional web, and permitted Operator interfaces produce the same Platform Command Envelope and outcome.

## Blocked by

- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
