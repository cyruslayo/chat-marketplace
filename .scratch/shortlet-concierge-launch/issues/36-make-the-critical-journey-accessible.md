# Make the critical guest journey accessible and Nigeria-localized

Status: resolved
Type: AFK
User stories: 98–99

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Make search, quote, offer, payment status, arrival, incident remedy, and fallback usable to WCAG 2.2 AA with keyboard, screen readers, reduced motion, stable focus, 320-pixel mobile layouts, degraded networks, English (Nigeria), NGN, and unambiguous WAT deadlines.

## Acceptance criteria

- [x] Approved components expose correct semantics, focus, errors, contrast, reflow, touch targets, and restrained live updates.
- [x] Money uses kobo and locale-safe display; contractual time always includes an absolute Africa/Lagos value.
- [x] Critical text precedes nonessential media, offline and stale state are explicit, and unsafe material actions disable.
- [x] Automated checks and representative keyboard, screen-reader, reduced-motion, slow-network, and small-screen tests pass.

## Blocked by

- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 16](16-verify-access-with-live-support.md)
- [Issue 23](23-let-the-guest-choose-relocation-or-refund.md)

## Answer

Implemented `AccessibilityLocalizationManager` in `domains/shortlet/src/accessibility-localization.ts` and test suite `test/make-the-critical-journey-accessible.test.ts`.

Key architectural compliance:
- **ADR 0078 & AC1**: WCAG 2.2 AA semantics, restrained live updates (`polite`), accessible error formatting, >=44px touch targets, >=4.5 contrast ratio.
- **ADR 0015, ADR 0078 & AC2**: NGN stored in kobo with `en-NG` formatting (`₦150,000.00`); contractual time always includes absolute `Africa/Lagos` (WAT) timestamp.
- **ADR 0078 & AC3**: Critical text precedes nonessential media in surface projection payload; explicit offline/stale state; disables unsafe material actions when offline or stale.
- **ADR 0078 & AC4**: Validation suite verifying 320px viewport layout, reduced motion, slow network (56kbps), keyboard navigation, and screen reader announcements.

