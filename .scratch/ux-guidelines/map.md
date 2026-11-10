# UX guidelines effort: map

Standard: `docs/design/shortlet-ux-guidelines.md` (adopted 10 Nov 2026). Accepted ADRs and the Guest UI kit take precedence (§1).
Scope: shortlet guest and Operator flows only. Commerce stays off (ADR 0104); no commerce issues here.

## Goal

Every critical guest and Operator screen meets the screen contract (§5), vocabulary (§9), money and state rules (§10), the accessibility and slow-network contract (§12) and the release gates (§14). This is proved by tests, captures and a user-observed task study.

## Rules for the whole effort

- **Phase 0 authorises no redesign.** Research issues change no code, CSS or copy.
- **Use the kit** (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). Do not invent components, policy text or money.
- **Assistant-path issues** (06, 11, 22, and any change to `apps/local-guest/src/assistant/` or the shell/runtime sync) follow ADR 0106: runtime enabled, cold restore before every event, staging-like clock and guest.
- **`client.ts` changes run one at a time:** 11, 14, 19, 21, 24.
- **One capture sweep or browser suite at a time.**
- **Foundation CSS:** commit `shortlet-foundations.css` edits before running `test/landing-page.test.ts`, because it fails on any uncommitted change. Keep literal six-digit hex tokens and the committed formatting (`guest-kit.test.ts`, `shortlet-design-system.test.ts`).
- **Browser support:** Baseline widely available features freely. Newly available features only with feature detection and graceful degradation. Reference device: a low-end Android phone running Chrome.
- **Test scope:** per AGENTS.md. Each issue runs `npm run check` plus its own and affected tests. Each batch ends with the pre-merge gate on a merge worktree. Merge to main only with the owner's approval.

## Batches and issues

| Batch | Phase | Issues | Notes |
| --- | --- | --- | --- |
| A | 0: re-baseline | 01, 02, 03, 04, 05 | Research. 04 is ready-for-human (staging timing). 05 is blocked by 01 to 04. |
| A | 1: state and copy | 06, 07, 08, 09, 10, 11, 12 | 06 to 11 are already confirmed from code. 10 is a grilling issue. 12 is blocked by 05. |
| B | 2: hierarchy, controls, accessibility | 13 to 20 | 20 is blocked by 05. 14 and 19 change `client.ts`. |
| C | 3: recovery, network, parity | 21 to 25 | 21 and 24 change `client.ts`. 22 is the regression suite. |
| D | 4: Operator and Extended Stays | 26, 27, 28 | 28 is ready-for-human (counsel-approved text, ADR 0092). |
| E | 5: user-observed gate | 29, 30, 31 | 29 is ready-for-human. 31 is blocked by every open P0 and P1. |

Frontier: the first open, unblocked, unclaimed issue in number order.

## Modern-web decisions

| Feature | Decision | Where |
| --- | --- | --- |
| Container queries | Adopt (widely available) | 18 |
| `content-visibility: auto` with `contain-intrinsic-size` | Adopt for older turns and long lists only, never above the fold. Newly available; ignored where unsupported. Check keyboard reachability. | 24 |
| `scrollbar-gutter: stable`, opacity skeleton | Adopt | 24 |
| `width`/`height`, `srcset`/`sizes`, `fetchpriority` on the lead image only | Adopt | 23 |
| `AbortSignal.any` for a cancellable turn | Adopt, feature-detected, falling back to a manual `AbortController` | 21 |
| `interactive-widget=resizes-content`, `field-sizing: content` | Progressive enhancement | 25 |
| Native `<dialog>` (`showModal`, `closedby="any"`) | Adopt for any guest-path modal (pattern: `listing-gallery.ts`) | 16 |
| `[aria-busy]` selector, `text-wrap: pretty`, `accent-color` | Adopt | 17 |
| `light-dark()` | Not now: breaks the token regex tests for little gain | — |
| `@layer` reorganisation | Not now: risky across tests, no user gain | — |
| View Transitions | Not now: motion cost on low-end phones, no comprehension gain | — |

## Open owner decisions

- **"Amount Due Now"** (guideline §9/§10) versus the current `GUEST_FACT_LABELS.amountDueNow` = "Total to complete booking". Raised in 05.
- **Server-computed total plus deposit** in `discovery-a2ui.ts:147`. Decided in 10.
- **Whether the owner maintains `@cylayo/weaver-web`.** This decides where 13 and 16 are fixed.
- **Counsel-approved Extended Stay text.** Supplied in 28.

## Context pointers

(Add one line per resolved issue.)

- 06 — guest copy: internal terms and raw IDs removed; receipt "Request sent. Waiting for the Operator to respond." Evidence: `test/guest-internal-terms.test.ts`, `apps/web-agent/src/guest-content.ts`, `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`.
- 07 — payment-callback failures: standard guest page, no false success; thread shows a not-confirmed banner. Evidence: `test/payment-callback-page.test.ts`, `apps/local-guest/src/guest-server.ts`, `.scratch/ux-guidelines/screenshots/07/`.
- 08 — money and labels: every guest A2UI builder uses `formatMoney`; deposit-claim statuses and pending-action labels are guest words. Evidence: `test/guest-money-format.test.ts`, `apps/web-agent/src/*a2ui.ts`, `apps/local-guest/src/assistant/pending-action-a2ui.ts`.
- 09 — dates: stay dates and calendar days use `en-NG`; contractual times are `Africa/Lagos` WAT; date-only values stay in UTC. Evidence: `test/guest-date-format.test.ts`, `apps/web-agent/src/booking-presentation.ts`.
- 11 — changed elsewhere: `ARTIFACT_MISMATCH` and stale/conflict rejections mark the surface out of date, refresh state, and show the changed-elsewhere sentence; forged ids still fail closed. Evidence: `test/guest-changed-elsewhere.test.ts`, `apps/local-guest/src/stale-surface-response.ts`, `apps/local-guest/src/client.ts`.
