# Store page and order tracking page from the same presentation helpers as chat

Status: ready-for-agent
Type: task
Blocked by: 23, 14b
Requested: 14 Oct 2026
Unlocks: none
Lane: E: Concierge UX
PRD: `../PRD.md`

## Why

Merchants share store links (instastore `/s/<slug>`); chat and pages must render the same facts from the same helper (AGENTS.md guest UI rule).

## What to build

Commerce route module: store page, offer page, cart, checkout handoff, order tracking (public code + phone, as instastore `get_order_status`). Use the guest kit and commerce presentations from slice 23.

## Out of scope

- Merchant branding beyond tokens.

## Acceptance criteria

- AC1: Store page and chat show the same offer facts from one presentation helper.
- AC2: Order tracking requires both the public code and the matching phone.
- AC3: Captures at the four widths pass the overflow and 44px checks.

## Tests

Browser tests; captures under `screenshots/27/`.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md` | Accessibility. |
| `docs/adr/0077-project-canonical-interaction-artifacts-across-channels.md` | Same artifacts. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

- 18 Oct 2026: Copy approved by the user, 18 Oct 2026 (`COMMERCE_GUEST_COPY` as committed).

- 18 Oct 2026 (review fixes, new commit on mdp/27-store-and-tracking): the coordinator review of 94c7eec is addressed as follows.
  - Phone rule: local Nigerian recognition only for mobile prefixes 070, 080, 081, 090 and 091 (named constant `NIGERIAN_MOBILE_PREFIXES`, coordinator recommendation of 18 Oct 2026, awaiting user confirmation). `07911123456` is unchanged; `00234 801 234 5678` canonicalises to the same value as the other forms.
  - Tracking limits (5 wrong-phone attempts, 15 minutes; configurable, validated as positive integers) and the phone rule are recorded as the user's 18 Oct 2026 decisions in `domains/commerce/CONTEXT.md`. ADRs 0095 and 0101 are cited for the hosting and platform boundaries within which the tracking data sits.
  - Migration 5 is the only source of `merchant_order_tracking_attempts`; the pack constructor no longer creates it. The local guest runtime applies the commerce migrations through `applySchemaMigrations` before creating the commerce pack. Migration numbering is unchanged; issue 24 moves to 6 after this merges.
  - Idempotency: the same payment reference with a differently written, same canonical phone returns the existing order (test added).
  - The default app bar with no brand is byte-identical to the previous Shortlet bar (test added). A 60-character store name wraps in the top bar at 320px with no overflow, so no CSS change was needed.
  - Shared fixture: `test/helpers/commerce-fixture.ts` (one migrated database, used by the domain and route tests).
  - Evidence: `screenshots/27/findings.txt` (per capture, per width and theme). `screenshots/27/checkout-23/` is the capture-23 output, produced by `npx tsx .scratch/guest-ui-consistency/capture-23.ts screenshots/27/checkout-23`. `screenshots/27/capture-11/` holds the capture-11 sweep findings and log. Issue 23's `screenshots/23-checkout-fix` is unchanged.
  - Why the `track-matched` PNGs changed: each run creates a fresh random public order code (ORD-...), so the code printed in the image changes on every capture. The layout, status and time are the same.
  - Test output. Before (94c7eec, focused commerce suites): 58 pass, 0 fail. After (same suites plus the new tests): 72 pass, 0 fail. Kit and foundation suites: 104 pass, 0 fail, 1 skipped. Guest server related non-browser suites: 123 pass, 0 fail. Store pages real-browser: 1 pass. Surfaces Chromium: 2 pass.
  - Capture-11 sweep: 21 groups, no horizontal overflow. Controls under 44px appear only as hidden native radio inputs (1x1) on the payment-choice page, the documented exception whose labels are the 44px targets.
