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
- **Phase 0 evidence:** each of 01 to 04 writes its rows to `evidence/NN-rows.md`, so parallel agents never share a file; 05 merges them into `evidence-matrix.md`. Agent prompts: `prompts/phase0.md`.
- **Foundation CSS:** commit `shortlet-foundations.css` edits before running `test/landing-page.test.ts`, because it fails on any uncommitted change. Keep literal six-digit hex tokens and the committed formatting (`guest-kit.test.ts`, `shortlet-design-system.test.ts`).
- **Browser support:** Baseline widely available features freely. Newly available features only with feature detection and graceful degradation. Reference device: a low-end Android phone running Chrome.
- **Test scope:** per AGENTS.md. Each issue runs `npm run check` plus its own and affected tests. Each batch ends with the pre-merge gate on a merge worktree. Merge to main only with the owner's approval.

## Batches and issues

| Batch | Phase | Issues | Notes |
| --- | --- | --- | --- |
| A | 0: re-baseline | 01, 02, 03, 04, 05 | Research. 04 is ready-for-agent with an owner handoff at the Paystack step. 05 is blocked by 01 to 04. |
| A | 1: state and copy | 06, 07, 08, 09, 10, 11, 12 | 06 to 11 are already confirmed from code. 10 is a grilling issue. 12 is blocked by 05. |
| B | 2: hierarchy, controls, accessibility | 13 to 20 | 20 is blocked by 05. 14 and 19 change `client.ts`. |
| C | 3: recovery, network, parity | 21 to 25 | 21 and 24 change `client.ts`. 22 is the regression suite. |
| D | 4: Operator and Extended Stays | 26, 27, 28 | 28 is ready-for-human (counsel-approved text, ADR 0092). |
| E | 5: user-observed gate | 29, 30, 31, 32 | 29 is ready-for-human. 30 is resolved (owner approved the events); 32 implements them. 31 is blocked by every open P0 and P1. |

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

- **"Amount Due Now"** (guideline §9/§10) versus the current `GUEST_FACT_LABELS.amountDueNow` = "Total to complete booking". **Decided 12 Nov 2026: keep "Total to complete booking".** It is the guest label for the glossary term Amount Due Now; do not rename it from the guideline text. The glossary meaning (`domains/shortlet/CONTEXT.md`: All-In Stay Total plus any upfront deposit) is what the label already shows. Guest UI consistency issue 12 (c0db5d5, 2 Oct 2026) chose the plain wording on purpose: the stay and the deposit are collected as two payments, so "Amount Due Now ₦390,000" would misread when the first charge is ₦370,000. 05 records the decision.
- **Server-computed total plus deposit** in `discovery-a2ui.ts:147`. **Decided in 10:** render the existing projected `amountDueNowKobo`; no presentation-level addition, no follow-up domain task.
- **Whether the owner maintains `@cylayo/weaver-web`.** **Decided:** yes, but the published 0.2.1/0.3.1 ignore the A2UI accessibility labels and there is no newer release, so 13 (and 16, which found no guest Modal) use the owner-approved client fallback.
- **Counsel-approved Extended Stay text.** 28 added only the owner-approved structural line; the cancellation and Notice to End terms still need counsel text (an open gate for 31).
- **Release sign-off (31).** **Decided 12 Nov 2026:** 31 may sign off with the Extended Stay counsel text (28) and the user study (29) listed as open gates; it no longer waits for 29.
- **Funnel events (30).** **Decided 11 Nov 2026:** all three approved; implemented in 32.

## Context pointers

(Add one line per resolved issue.)

- 06 — guest copy: internal terms and raw IDs removed; receipt "Request sent. Waiting for the Operator to respond." Evidence: `test/guest-internal-terms.test.ts`, `apps/web-agent/src/guest-content.ts`, `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`.
- 07 — payment-callback failures: standard guest page, no false success; thread shows a not-confirmed banner. Evidence: `test/payment-callback-page.test.ts`, `apps/local-guest/src/guest-server.ts`, `.scratch/ux-guidelines/screenshots/07/`.
- 08 — money and labels: every guest A2UI builder uses `formatMoney`; deposit-claim statuses and pending-action labels are guest words. Evidence: `test/guest-money-format.test.ts`, `apps/web-agent/src/*a2ui.ts`, `apps/local-guest/src/assistant/pending-action-a2ui.ts`.
- 09 — dates: stay dates and calendar days use `en-NG`; contractual times are `Africa/Lagos` WAT; date-only values stay in UTC. Evidence: `test/guest-date-format.test.ts`, `apps/web-agent/src/booking-presentation.ts`.
- 11 — changed elsewhere: `ARTIFACT_MISMATCH` and stale/conflict rejections mark the surface out of date, refresh state, and show the changed-elsewhere sentence; forged ids still fail closed. Evidence: `test/guest-changed-elsewhere.test.ts`, `apps/local-guest/src/stale-surface-response.ts`, `apps/local-guest/src/client.ts`.
- 10 — discovery totals: the budget note renders the server-projected `amountDueNowKobo`, never a presentation sum. Evidence: `test/discovery-budget-note.test.ts`, `apps/web-agent/src/discovery-a2ui.ts`, `domains/shortlet/src/browse.ts:372`.
- 13 — accessibility labels: the client applies A2UI `accessibility.label` after mount, keeping the visible label (owner-approved client fallback; published Weaver ignores it). Evidence: `apps/local-guest/src/a2ui-accessibility.ts`, `test/a2ui-accessibility.test.ts`, `test/guest-discovery-consistency-chromium.test.ts`.
- 16 — guest Modal: no guest A2UI builder emits Modal, so no native-dialog change is needed. Evidence: `test/guest-modal-usage.test.ts`.
- 15 — skip links: every standard guest and error page starts with a 44x44 "Skip to main content" link that focuses the main region. Evidence: `test/guest-skip-link.test.ts`, `test/guest-skip-link-chromium.test.ts`, `.scratch/ux-guidelines/screenshots/15/`.
- 17 — targets and text: 44x44 controls, 12px text floor, `aria-busy` styling, prose wrapping and accent colours. Evidence: `test/guest-kit-targets.test.ts`, `.scratch/ux-guidelines/screenshots/17/`.
- 18 — container queries: the workspace and standard-page main are containers; compare, facts and discovery layout follow the column. Evidence: `test/guest-container-queries-chromium.test.ts`, `.scratch/ux-guidelines/screenshots/18/`.
- 14 — focus and announcements: first workspace focus, one announcement source, polite criteria status, one task-naming H1. Evidence: `test/guest-focus-announcements.test.ts`, `test/guest-focus-announcements-chromium.test.ts`, `.scratch/ux-guidelines/screenshots/14/`.
- 19 — surface hooks: the server declares surface kind and contact purpose; the client reads them instead of ids or labels. Evidence: `test/guest-surface-hooks.test.ts`, `apps/local-guest/src/contact-field.ts`, `apps/local-guest/src/shortlet-app.ts`.
- 21 — cancellable turn: Cancel after the still-working threshold; a landed turn is shown, otherwise the text stays with "Stopped waiting. Your message may still be answered." Evidence: `test/guest-turn-cancel.test.ts`, `test/guest-turn-cancel-chromium.test.ts`.
- 22 — recovery regression: stale/forged refusals, one effect across tabs, model-failure state, fallback text/route, no false confirmation, and no-JS route parity. Evidence: `test/guest-recovery-regression.test.ts`.
- 23 — slow-network images: intrinsic dimensions, lead-only eager/high, broken-photo fallback and zero layout shift. Evidence: `test/guest-image-layout.test.ts`, `test/guest-image-layout-chromium.test.ts`, `.scratch/ux-guidelines/screenshots/23/`.
- 24 — long conversations: older turns defer rendering but stay reachable, stable scrollbar gutters, opacity skeleton. Evidence: `test/guest-long-conversation.test.ts`, `test/guest-long-conversation-chromium.test.ts`, `.scratch/ux-guidelines/screenshots/24/`.
- 25 — composer: `interactive-widget=resizes-content`, progressive `field-sizing`, 16px text; the textarea premise is recorded as a contradiction. Evidence: `test/guest-composer-sizing.test.ts`, `test/guest-composer-sizing-chromium.test.ts`, `.scratch/ux-guidelines/screenshots/25/`.
- 26 — Operator clarity: human stay dates, sentence-case status labels, decision submit disabled while in flight, legacy dashboard relabelled (reachable at `/` in non-production). Evidence: `test/operator-detail-clarity.test.ts`, `.scratch/ux-guidelines/screenshots/26/`.
- 27 — Extended Stay schedule: offer and payment show the full range, every Billing Period with due date, and which period is being paid; schedule-page lead follows paid state; Short Stay unchanged. Evidence: `test/extended-stay-schedule.test.ts`, `.scratch/ux-guidelines/screenshots/27/`.
- 28 — Extended Stay collection line: later Billing Periods are paid separately and are not charged automatically (owner-approved structural line only; cancellation and Notice to End remain counsel text). Evidence: `test/extended-stay-counsel-copy.test.ts`.
- 29 — task study protocol prepared (nine tasks, consent script, observation sheet); the owner runs the sessions. Evidence: `.scratch/ux-guidelines/study/protocol.md`.
- 30 — funnel-signal proposal: every §13 signal mapped to existing telemetry plus three proposed closed-enum events; no code changed pending approval. Evidence: issue 30 Comments.
