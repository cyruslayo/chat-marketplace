# Guest chat-first UX: map

Effort map for the chat-first UX audit of the deterministic guest demo (`npm run guest:local`, :3001). The Gemini assistant path is out of scope for this round.

- PRD: [PRD.md](PRD.md)
- Report: https://claude.ai/artifact/SN6HVci7M4bjpVthVtmA5Y

## Delivery rules

- **One slice = one branch `ux/sN-<slug>` = one PR.** Review and merge each slice before the next one starts.
- **Tests first:** one named `test()` per acceptance criterion, including its failure paths.
- **Checks:** `npm run check` and `npm test` must pass, apart from the known failures below.
- **Walkthrough:** check the change on :3001 at 375px and 1280px.
- **Hotspots:** `#handleTurn`, `#refreshWorkflow`, the shell HTML/CSS in `guest-server.ts`, and `renderSurface` in `client.ts`. Only one slice may be editing them at a time.
- **Tests:**
  - Server logic: direct `LocalGuestApp` calls.
  - HTTP: `startLocalGuestServer({port:0})`.
  - Browser behaviour: `test/helpers/chrome-devtools.ts`.
  - Shared helpers: reuse `test/helpers/guest-restart.ts`.

## Baseline (S0, complete — 25 Sept 2026)

Run on `main` before S1:
- `npm run check`: passed (`tsc --noEmit`, zero errors).
- `npm test`: passed; 1,078 passed, 0 failed, 1 skipped (1,079 tests total; 6 suites). Duration: 310.6 seconds.
- The previously listed RB6/RB10/RB12 cross-tab failures and duplicate-offer-after-restart failure did not reproduce in this run.
- The initial test invocation hit a 120-second command timeout; the full rerun completed successfully with no test failures.

Known failures, recorded and **not** fixed in this effort (user decision, 25 Sept 2026):
- `test/guest-real-browser-cross-tab.test.ts`: RB6, RB10 and RB12 (`HANDOFF-goal2-real-browser-correction.md`)
- `test/guest-browser-restart.test.ts`: duplicate offer after restart; the fix is unverified (`HANDOFF-guest-restart-persistence.md`)

A failure outside this list blocks a slice.

## Slices (frontier = first open, unblocked row)

| Slice | Issue | Blocked by | Milestone |
|---|---|---|---|
| S0 | Baseline (no issue file) | none | M1 |
| S1 | [05](issues/05-a11y-semantics.md) Accessibility semantics | S0 | M1 |
| S2 | [12](issues/12-liveness.md) Typing indicator, timeout, retry | 05 | M1 |
| S3 | [07](issues/07-copy-pass.md) Glossary and copy | S0 | M1 |
| S4 | [01](issues/01-confirm-real-dates.md) Real dates, confirmed | 07 | M1 |
| S5 | [02](issues/02-reflective-replies.md) Reflective replies | 01 | M1 |
| S6 | [04a](issues/04a-never-silent.md) Never silent | 07, 02 | M1 |
| S7a | [06a](issues/06a-conventional-search.md) Conventional search page | 07 | M2 |
| S7b | [06b](issues/06b-conventional-booking-pages.md) Conventional booking pages | 06a | M2 |
| S7c | [06c](issues/06c-no-js-composer.md) Composer without JavaScript | 06b | M2 |
| S8 | [08](issues/08-journey-rail.md) Journey rail and back to results | 04a | M3 |
| S9 | [10](issues/10-waiting-states.md) Waiting states and countdowns | 08 | M3 |
| S10a | [03a](issues/03a-criteria-strip.md) Criteria strip and undo | 02, 10 | M3 |
| S10b | [03b](issues/03b-budget.md) Budget | 03a | M3 |
| S11 | [11](issues/11-discovery-reasons.md) Fit reasons and quick replies | 03b | M3 |
| S12 | [09](issues/09-split-workspace.md) Split and sheet workspace | 08 | M3 |
| S13a | [13a](issues/13a-new-conversation.md) New conversation | 09 | M4 |
| S13b | [13b](issues/13b-compare.md) Compare two apartments | 11, 09 | M4 |
| S14 | [14](issues/14-draft-revision.md) Draft revision (**decision needed first**) | 04a | M4 |

**Parallel lane (optional):** S7a–S7c touch only the router and new page renderers. They can run on a second branch alongside S4–S6.

**Milestones:**
- **M1 trustworthy:** the concierge understands, tells the truth, never goes silent, and is accessible.
- **M2 parity:** ADR 0080 conventional routes are complete.
- **M3 structure:** journey rail, waiting states, criteria strip, discovery reasons, layout.
- **M4 power tools:** new conversation, compare, draft revision.

## Epics (split parents)

- [03](issues/03-criteria-strip.md) is delivered by 03a and 03b.
- [04](issues/04-never-silent.md) is delivered by 04a and 14.
- [06](issues/06-conventional-routes.md) is delivered by 06a, 06b and 06c.
- [13](issues/13-thread-control.md) is delivered by 13a and 13b.

## Context pointers (append as slices resolve)

- S1 accessibility semantics: [issue 05](issues/05-a11y-semantics.md) — named native action buttons, polite conversation log, assertive error announcements, focused-workspace Escape and focus return, and scrollable transcript/workspace regions.
