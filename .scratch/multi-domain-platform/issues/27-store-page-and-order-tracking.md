# Store page and order tracking page from the same presentation helpers as chat

Status: resolved
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
  - Phone rule: local Nigerian recognition only for mobile prefixes 070, 080, 081, 090 and 091 (named constant `NIGERIAN_MOBILE_PREFIXES`, confirmed by the user, 18 Oct 2026). `07911123456` is unchanged; `00234 801 234 5678` canonicalises to the same value as the other forms.
  - Tracking limits (5 wrong-phone attempts, 15 minutes; configurable, validated as positive integers) and the phone rule are recorded as the user's 18 Oct 2026 decisions in `domains/commerce/CONTEXT.md`. ADRs 0095 and 0101 are cited for the hosting and platform boundaries within which the tracking data sits.
  - Migration 5 is the only source of `merchant_order_tracking_attempts`; the pack constructor no longer creates it. The local guest runtime applies the commerce migrations through `applySchemaMigrations` before creating the commerce pack. Migration numbering is unchanged; issue 24 moves to 6 after this merges.
  - Idempotency: the same payment reference with a differently written, same canonical phone returns the existing order (test added).
  - The default app bar with no brand is byte-identical to the previous Shortlet bar (test added). A 60-character store name wraps in the top bar at 320px with no overflow, so no CSS change was needed.
  - Shared fixture: `test/helpers/commerce-fixture.ts` (one migrated database, used by the domain and route tests).
  - Evidence: `screenshots/27/findings.txt` (per capture, per width and theme). `screenshots/27/checkout-23/` is the capture-23 output, produced by `npx tsx .scratch/guest-ui-consistency/capture-23.ts screenshots/27/checkout-23`. `screenshots/27/capture-11/` holds the capture-11 sweep findings and log. Issue 23's `screenshots/23-checkout-fix` is unchanged.
  - Why the `track-matched` PNGs changed: each run creates a fresh random public order code (ORD-...), so the code printed in the image changes on every capture. The layout, status and time are the same.
  - Test output. Before (94c7eec, focused commerce suites): 58 pass, 0 fail. After (same suites plus the new tests): 72 pass, 0 fail. Kit and foundation suites: 104 pass, 0 fail, 1 skipped. Guest server related non-browser suites: 123 pass, 0 fail. Store pages real-browser: 1 pass. Surfaces Chromium: 2 pass.
  - Capture-11 sweep: 21 groups, no horizontal overflow. Controls under 44px appear only as hidden native radio inputs (1x1) on the payment-choice page, the documented exception whose labels are the 44px targets.

## Answer

Resolved 19 Oct 2026. The implementation commits `2c6a62b`, `0f8a1f9`, `89d9c63`, `94c7eec`, `7ee761a` and `23879d7` were fast-forwarded into local `main` at `23879d7`. Nothing was pushed.

**Evidence**

- Full suite on `23879d7`: phase 1 1,867/1,867 passed. Browser phase 180 passed, 0 failed, 2 skipped. Exit 0. Log: `C:UsersCyrusAppDataLocalTempopencodemdp27-final-full-suite-3.log`.
- `npm run check` clean (reviewer run).
- Captures in `screenshots/27/` (store, offer, tracking matched and unmatched, chat discovery, long store name) at 320, 390, 768 and 1280, light and dark. No horizontal overflow. No controls under 44px (ADR 0078).
- Capture-11 sweep in `screenshots/27/capture-11/`: clean except the documented 1x1 hidden native radio inputs on payment-choice (their labels are the 44px targets).
- Independent review: ACCEPT.

**ADRs listed and read:** 0001, 0075, 0077, 0078, 0095, 0099, 0100, 0101, 0103.

**Acceptance criteria and their tests**

- AC1 (store page and chat show the same offer facts from one presentation helper), `test/commerce-store-routes.test.ts`: "AC1: Store page and chat show the same offer facts from one presentation helper"; "AC1: chat discovery surface for the store offer shows the same facts as the store page and its references resolve".
- AC2 (order tracking requires both the public code and the matching phone), `test/commerce-store-routes.test.ts`: "AC2: Order tracking requires both the public code and the matching phone"; "AC2: unknown-code and wrong-phone responses are byte-identical, and every tracking response is no-store"; "AC2: the matched order shows Last updated in WAT and never as a raw ISO timestamp"; "AC2: the domain tracking lookup returns only the minimal projection, or null for any mismatch"; "AC2 tracking: a locked lookup returns the same bytes, status and headers as a wrong phone".
- AC2 lock rules, `test/commerce-order.test.ts`: "AC2 tracking: the sixth attempt with the correct phone inside the window is still refused"; "AC2 tracking: the lock expires when the fifteen-minute window ends"; "AC2 tracking: unknown codes create no attempt rows"; "AC2 tracking: the attempt limit and window are configurable options".
- AC3 (captures at the four widths pass the overflow and 44px checks), `test/commerce-store-pages.real-browser.test.ts`: "AC3: Captures at the four widths pass the overflow and 44px checks".

**Failure paths named in the tests:** not-found and malformed resources return safe pages; a store whose Merchant is not verified and an inactive store fail closed; a wrong phone and a locked lookup return the same bytes as an unknown code; the sixth attempt with the correct phone is refused inside the window.

**Definition of Done**

1. [x] Every acceptance criterion has a dedicated named test whose name mirrors the criterion text (AC1 to AC3 above).
2. [x] The named failure paths are exercised (listed above).
3. [x] Every relevant ADR is listed and read (above). ADRs 0095 and 0101 are cited for the hosting and platform boundaries in the 18 Oct Comments entry.
4. [x] No injected dependency is unused. Checked by the independent review (ACCEPT). Not separately re-verified in this pass.
5. [x] No policy string, rule or constant invented. The tracking limits (5 attempts, 15 minutes, configurable), the Nigerian mobile prefixes (070, 080, 081, 090, 091, stored as +234) and the store name in the top bar were decided by the user on 18 Oct 2026. Known follow-up (a) below concerns the lock.
6. [x] No bearer credential or restricted identity material in audit records or logs (ADR 0075). Checked by the independent review (ACCEPT). Not separately re-verified in this pass.
7. [x] `npm run check` clean and `npm test` with zero failures on `23879d7` (counts above; the 2 browser skips are recorded in the log).

**User decisions of 18 Oct 2026:** copy approved; tracking lock of 5 attempts / 15 minutes; Nigerian mobile prefixes 070/080/081/090/091 confirmed, stored as +234; store name in the top bar; ₦ everywhere; offer heading not duplicated.

**Known issues, not fixed in this slice**

- (a) Anyone with a public code can lock tracking for 15 minutes.
- (b) The commit message's ADR 0099 row says the façade "exports only createCommercePack", although it also exports types.
- (c) The pre-existing listing-viewer timing race; fix on branch `platform/18oct-fixes`.
- (d) Issue 24 must renumber its commerce migration to 6 and preserve `merchant_order_tracking_attempts` when rebuilding `merchant_orders`.
