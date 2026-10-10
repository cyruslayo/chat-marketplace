# Handoff: guest UI consistency — issues 07 and 10 done; issue 08 next

Saved at the user's request in the working directory. Continue from here in a fresh session.

## Current resume state — supersedes the historical notes below

**Latest:** issue 10 is resolved. Implementation `5b73998`; tracker/map resolution `b5f45ad`. The final actual `npm test` exits 0: **1218 non-browser passes, 154 Chromium passes, 1 pre-existing skip, zero failures**. Typecheck and diff checks are clean. All 16 final captures pass reflow/44px checks and are committed. No suite or capture processes from this session remain running. No push or merge.

Next: issue 08 → 09 → 11, following the approved plan. Issue 12 stays open. Issue 11 needs user review before resolution. The issue-10 details below describe the completed implementation; their earlier in-progress verification notes are historical and superseded by this paragraph.

### Issue 10 current frontier (30 Sept 2026)

Issue 10 is **claimed**, implemented and uncommitted. The user chose **Reservation ID verbatim** for the booking reference. New shared content: `apps/web-agent/src/confirmation-presentation.ts`; shared markup: `confirmationScreenHtml` in `guest-kit.ts`. Server projects metadata on confirmed surfaces and owner-authorized conventional pages; client validates it and organizes the shared ticket/breakdown/steps/actions/details. Provider/named guest/policy/checkout copy is retained in the details section. Collected-deposit wording is gated on held state, and Amount paid remains today's value.

`appBarHtml` moved from guest-kit to `apps/web/src/ui-kit.ts` (guest-kit re-exports it), letting `errorPage` use the same frame without an upward dependency. Error pages have one pill recovery action and no rail; unmapped `sendPageError` codes now render a generic HTML recovery page for HTML clients and keep JSON for API clients.

No-JS conversation now uses the shared app bar/rail, chat bubble/receipt/composer classes and native result-row links with complete fallback text. The native POST/contact/thread behavior is unchanged. `test/guest-journey-rail.test.ts` assertions were updated for the kit rail.

**Verification:** `npm run check` clean, 11 new issue tests pass, isolated journey file 8/8. All 43 mobile journey tests and five gallery tests pass after updating the old mobile confirmation assertion to the kit success pill. New conversation's Escape test now synchronizes focus and keydown result; its isolated file passes 2/2. Sixteen light captures saved in `screenshots/10/`; final capture run exits 0 and all reflow/44px checks pass (waits for fonts before measuring).

**Active final full-suite rerun:** `.scratch/guest-ui-consistency/run-full-10.mjs`, log `full-test-10.log`, background shell `sh_0f32d8a5c001JAjjwLCbgjZXES`. Wait for notification; do not poll or launch overlapping browser suites. Previous run failed on the old no-JS rail assertion and eight old mobile status assertions (now updated), plus the documented New conversation/gallery flaky tests (isolated green). The final actual `npm test` rerun includes all fixes. When it passes: explicitly verify ADR/DoD, commit issue10 paths/screenshots explicitly, resolve/map-update, continue 08 → 09 → 11. No issue10 commit yet; latest remains `d429349`.

Issue-10 Comments record ADRs, user decision, visual differences and pending verification. Keep unrelated scratch deletions/untracked work untouched.

### Issue 07 completed baseline

Issue 07 is now **resolved**. Implementation commit: `f802424`; resolution/map commit: `d429349` on `ui/guest-consistency`. No push or merge. The source changes below are committed; the unrelated `scratch/**` deletions and pre-existing untracked files remain untouched.

- `guest-server.ts` now projects shared `RequestScreenContent`, renders conventional request screens, supplies the stored self-booking attestation, enables safe outcome kit rendering, and provides owner-checked POST actions for review/submit/conversation/search. Draft/review reuse the current Weaver action handlers and existing platform commands. Historical draft pages disable material actions.
- `client.ts` now renders the shared request kit around the label-driven ticket/breakdown, validates request metadata, preserves Weaver event bindings through a hidden runtime button, keeps loading feedback on the visible primary button, and integrates operator-response countdown/refetch without the old waiting panel. Partial/older surfaces retain readable waiting guidance.
- Kit CSS and `requestScreenHtml` provide pill status/actions, guests card, neutral banner, steps card and draft/review action total. Named occupants remain visible on review. The tracked client bundle has been rebuilt.
- `test/helpers/guest-browser.ts` and `guest-waiting-states-chromium.test.ts` now use the request-screen waiting selector. New tests cover all ACs, native no-JS actions, stale/bypass/duplicate authority, disabled historical actions and visible loading feedback. Ten new tests total (7 Chromium, 3 non-browser).
- `.scratch/guest-ui-consistency/issues/07-request-screens.md` records the ADR table, intentional deviations, Answer and completed DoD; `map.md` has the 07 context pointer.
- **40 light captures** are saved in `.scratch/guest-ui-consistency/screenshots/07/`: five states × page/chat × 320/390/768/1280. `.scratch/guest-ui-consistency/capture-07.ts` produces them and asserts reflow and 44px control targets. All checks passed; representative captures were compared with the approved renders. Final small changes after captures affect loading/disabled historical controls, not captured active-state layouts.

### Final verification

- `npm run check` is clean; the last complete non-browser phase passed **1210/1210**.
- The first complete Chromium phase finished **149 pass, 1 failure, 1 pre-existing skip** (151 tests, before the new loading-feedback test). Its sole failure was known-flaky `guest-new-conversation-chromium.test.ts` AC1 at the immediate Escape assertion, line 35.
- That file was rerun independently in a serial targeted command together with request consistency and waiting-state files: **11/11 passed**, including the now 7 request tests and 2 deadline/refetch tests. The flaky test was not modified.
- The final **actual `npm test`** completed with exit 0 through `.scratch/guest-ui-consistency/run-full-07.mjs`: **1210 non-browser passes; 151 Chromium passes, 1 pre-existing skip; zero failures**. Log: `.scratch/guest-ui-consistency/full-test-07.log`. No verification commands from this session are still running.

Next: continue issue 10, then 08, 09, 11 per the approved plan. Issue 12 stays open. Never stage the unrelated `scratch/**` deletions or diagnostic logs/tooling.

### Issue 10 discovery only

Read its issue and design artboards while waiting; no edits to issue 10 or its implementation have been made. The confirmed contract artifact exposes `contractId` and `reservationId` but no public `bookingReference`; existing confirmation copy only says the reference is in booking details. Manual transfers have their own payment reference, which must not be repurposed as a universal booking reference. Investigate this projection gap before inventing a reference for issue 10. Error pages currently have no app frame; `sendPageError` sends JSON for unknown codes. No-JS conversation still uses its old markup. See the approved plan for the full scope.

## Historical handoff notes (pre-resumption; current state above takes precedence)

## Goal

Implement the guest UI consistency effort. The plan is written and approved-in-flight at:
`C:\Users\Cyrus\.commandcode\plans\guest-ui-consistency-06-11.md` — read it first; do not restate it.
Sources of truth: `.scratch/guest-ui-consistency/PRD.md`, `.scratch/guest-ui-consistency/map.md`, and the per-issue files in `.scratch/guest-ui-consistency/issues/`. Protocol: `AGENTS.md` + `docs/agents/issue-tracker.md` (Definition of Done). Coding gate: `docs/agents/coding-standards.md`.

Frontier: **issue 07** (`issues/07-request-screens.md`, now `Status: claimed`). Continue the uncommitted work described below. Subsequent order is in the approved plan. Issue 12 stays open (needs the user).

## Repo / branch state

- Branch `ui/guest-consistency`. Latest commit remains **`a5b3413`** (issue 06). Issue 07 has partial, uncommitted changes and new untracked source/test files. No commit, push or merge happened in this session. Pre-existing *unrelated* deleted `scratch/**` files remain — never `git add -A`, stage files explicitly by path.
- PR **#96** (`ui/editorial-refinement` → `main`): last checked **OPEN, unmerged** (`mergeStateStatus: CLEAN`). Because it is unmerged, do **not** rebase; work stays on `ui/guest-consistency`. Re-check with `gh pr view 96 --json state,mergeStateStatus` before starting. Never merge or push unless asked.
- `apps/local-guest/dist/client.js` is tracked and must be committed whenever `client.ts` changes (rebuild with `node apps/local-guest/scripts/build-client.mjs`).

## Environment quirks (important)

- The shell has **`NODE_ENV=production`**, which makes `loadPaystackConfiguration()` throw and fails every test that starts a guest server. Run all test commands with `NODE_ENV=test`.
- **Background shell output is not captured** in this environment (both `shell_command run_in_background` and the powershell tool write empty logs; `> file` redirection also produced 0 bytes). Foreground commands return output fine, but cap at 10 minutes.
  - Workaround: `.scratch/guest-ui-consistency/run-phase.mjs` — replicates `scripts/run-tests.mjs`'s phase split (non-browser files concurrent; browser files with `--test-concurrency=1`) and pipes the child output into a workspace log that can be read while it runs.
  - PowerShell usage: `$env:NODE_ENV='test'; node .scratch/guest-ui-consistency/run-phase.mjs other` → `.scratch/guest-ui-consistency/phase-other.log`; `... browser 0` / `... browser 1` split the browser files into halves (logs `phase-browser0.log`, `phase-browser1.log`). Follow the harness's background-completion notifications; do not poll running commands.
- Known-flaky under full-suite load: `guest-new-conversation-chromium` AC1, `listing-gallery-chromium` AC3. Rerun a failing file alone before treating it as a regression.
- Non-ASCII (₦, ·, ★) break Bash heredocs; use the Write/Edit tools for files containing them.
- `capture.ts` sets `data-theme="light"` so captures match the light design; the guest shell is `data-theme="system"` and otherwise renders dark on a dark OS.
- The walkthrough (`start-walkthrough.mjs`) leaves node processes on ports 3021–3028; stop them (`taskkill /PID <pid> /T /F`) when done.

## Baseline

Issue 06 is resolved at `a5b3413`; see `.scratch/guest-ui-consistency/issues/06-unit-detail.md`, `map.md` and `screenshots/06/` for implementation and verification. The previous handoff reported 1207 non-browser passes and 144 Chromium passes, 1 pre-existing skip. Those are baseline counts, **not verification of the current partial changes**.

## Issue 07 — exact stopping point

The user requested this handoff during implementation. Stop here; resume from the diff, not from an assumed completed change.

### Applied work (inspect these files)

- `.scratch/guest-ui-consistency/issues/07-request-screens.md`: changed only to `Status: claimed`.
- New `test/helpers/guest-request-screen.ts`: reusable fixture for draft/review/sent/declined/expired, using the existing restart fixture; expiry at the exact response deadline.
- New `test/guest-request-consistency-chromium.test.ts`: four AC1 parity tests, AC3 neutral banner/steps/no waiting-panel, AC5 no-JS primary-action tests. The parity selectors are `.request-screen`, `.request-head`, `.ui-ticket`, `.ui-price-breakdown`, `.request-actions`, `.ui-steps`.
- New `test/guest-request-consistency.test.ts`: AC2 conditional tags, AC4 declined/expired recovery with criteria preserved, additional AC5 missing/foreign/stale/cross-origin form authority coverage.
- New `apps/web-agent/src/request-presentation.ts`: proposed shared `RequestScreenContent` plus `draftScreenContent`/`requestScreenContent` derived from artifacts and existing copy. **Not wired into any server/client path yet.**
- `apps/web/src/request-draft-artifact.ts`: optional stored self-booking attestation added to projection input and facts. **The server does not yet supply it.**
- `apps/web-agent/src/request-draft-a2ui.ts`: conditional tag now included for draft as well as review, matching AC2. Amount-due remains review-only.
- `apps/local-guest/src/guest-kit.ts`: added `requestScreenHtml` (typed shared content + kit ticket/breakdown slots, forms, status, steps, guests card). **Not called yet.** Review the proposed helper/content for style and correctness before wiring it.

### Verification so far

Before implementation, ran:

```powershell
$env:NODE_ENV='test'; npx.cmd tsx --test test/guest-request-consistency.test.ts test/guest-request-consistency-chromium.test.ts
```

All **9 tests failed**, establishing red coverage: missing request-screen kit layout, absent draft conditional tag, absent recovery/POST routes. This command ran before the partial source edits above. **No typecheck, rebuild, green test run, full suite or issue-07 captures have been performed since.** No tests or servers are running from this session.

### Next implementation work

1. Wire `RequestScreenContent` into `GuestSurfacePayload` and `ConventionalBookingPage` in `apps/local-guest/src/guest-server.ts`. Project draft/review content using `#draftArtifact`; request content using the current artifact and unit's operator. Consider `#withWaiting` as the centralized response-time enrichment for chat content; do not accidentally enrich draft replacement surfaces (`:request:replacement:`).
2. Supply the actual stored `draft.selfBookingAttestation` from `#draftArtifact` to the new optional artifact field (ADR 0012); never infer acceptance from chat.
3. Have `#bookingPage` and `renderConventionalBookingHtml` render the request-specific kit layout. Draft needs the condition tag without adding the review-only amount-due line. Other page kinds continue using their current paths until their issues.
4. Add owner-checked same-origin POST endpoints for draft `/review`, `/submit`, and request `/conversation`, `/search`. Reuse `handleEvent` and its existing draft action handlers/platform commands. The proposed forms submit a hidden `surfaceId`; reject missing, stale/wrong-stage and duplicate authority. Resolve action context server-side. Read `browserOriginAccepted` and existing POST routes before adapting them. Navigation redirects should work with JS off (the server-rendered `/conversation?threadId=...` route).
5. The existing `#handleBackToResults` rejects any sent request and is unsuitable for declined/expired recovery. Obtain the stored `thread.discoveryArtifact.facts.filters` after owner/outcome checks and redirect through existing `conventionalSearchRoute`; preserve all criteria, not just dates/party.
6. In `client.ts`, use the shared layout around the existing label-driven organized ticket/breakdown. Preserve Weaver action-button listeners when moving/replacing action slots. New presentation metadata must be validated (safe internal action URLs, field types), not trusted as arbitrary HTML. Older/incomplete surfaces must retain their readable fallback.
7. Request outcomes currently force `status: "fallback"` in `#restoreCurrentSurface` (around line 1210) and `#refreshWorkflow` (around line 2252). Allow the safe outcome kit to render while ensuring no material actions become available. Both occurrences still need changes.
8. Suppress only operator-response `.waiting-panel`; keep deadline/countdown and zero-time server refetch behavior. Integrate the countdown into the request layout. Update `test/guest-waiting-states-chromium.test.ts` and `test/helpers/guest-browser.ts` (currently wait for the operator-response panel). Offer/payment waiting panels belong to their later issues.
9. Finish targeted tests, typecheck, client bundle rebuild, full suite, visual captures and DoD; then commit and resolve per the approved plan.

**Important patch state:** Two attempted large patches to `guest-server.ts` failed validation and applied **nothing**. `guest-server.ts`, `client.ts`, foundation CSS and the tracked bundle are untouched. A final empty patch call was interrupted and also made no changes. Use small patches with exact current context; do not assume the attempted server methods/imports exist.

### ADR discovery already completed

Listed `docs/adr/` and read 0005, 0006, 0012, 0015, 0041, 0070, 0072, 0073, 0074, 0075, 0077, 0078, 0079, 0080, 0081, 0085. Also read both relevant CONTEXT documents, PRD/map, issue 07, standards and DoD. The constraint table was stated in commentary but **not persisted in issue Comments yet**:

| ADR | Constraint | Affects |
|---|---|---|
| 0005, 0006 | Request is not a Reservation; provider disclosure on review/sent | AC1, headings/disclosure |
| 0012 | Show stored self-booking attestation | AC1, guests card |
| 0015, 0077 | Preserve projected amounts, separate deposit, conditional wording | AC1–2 |
| 0041 | Expiry from server clock | AC3–4 |
| 0070, 0072, 0074, 0075 | Ownership, current authority, same commands, escaped/minimized content | AC4–5 |
| 0073, 0081 | Basic Catalog and existing action bindings | AC1, organizer |
| 0078, 0079 | Accessible reflow, authoritative countdown/refetch | AC3/layout |
| 0080, 0085 | Deterministic forms, existing contact requirements, no booking KYC gate | AC5 |

Record relevant constraints in issue Comments and verify the table after implementation.

## Issue 07 — decisions already made (do not re-ask)

The user answered the two open questions on 30 Sept 2026:

1. **Review action label: keep the existing `"Submit Booking Request"`** in both the chat and the conventional page. Do **not** rename it to the design's "Send request" — that would ripple through ~10 test files/helpers. Record the design wording as an intentional deviation in the issue's `## Comments`.
2. **No-JS primary actions: add POST routes.** The conventional request pages (draft, review, and the sent/not-accepted actions) must get new form-post endpoints (e.g. `POST /booking-requests/drafts/:id/review` and `/submit`) that reuse the existing platform commands (ADR 0072/0080), so the page's primary action really works without JavaScript. There is currently **no** route that advances a draft/review — only GET plus a back link.

Step copy: derive "What happens next" from existing copy only — `guestWaitingCopy("operator-response").outcomes` for review/sent (3 steps), the draft/review fallbacks, and `bookingProgressText`. Do not invent new promises; ask if a needed step has no source copy.

Parity note: the design's request screens drop the request-pending `.waiting-panel` for a neutral banner + `.ui-steps` (AC3). `guest-waiting-states-chromium.test.ts` currently keys on `.waiting-panel` and must be updated.

## Completion protocol

Follow `AGENTS.md`, the approved plan's per-issue protocol, and `docs/agents/issue-tracker.md` DoD. Stage exact paths; include the rebuilt tracked client bundle when relevant. Commit trailer: `Co-Authored-By: CommandCodeBot <noreply@commandcode.ai>`. Issue 07 has no Answer or new Comments yet. Do not resolve until all required checks/captures pass. Issue 11 needs the user's final capture review before resolution.

## Temporary / diagnostic files

Deletable scratch tooling lives in `.scratch/guest-ui-consistency/` (`run-phase.mjs`, `start-walkthrough.mjs`, `repro*.ts`, `diag.txt`, `phase-*.log`, `full-test-06.log`, `walkthrough-06.log`). They are untracked and are not part of the suite; keep `run-phase.mjs` and `start-walkthrough.mjs` for the remaining issues.

## Suggested skills

- `modern-web-guidance` — required at the start of frontend implementation. This session loaded it and ran the accessible progressive-enhancement search and retrieved the `forms` guide; reload in a fresh session as needed.
- `tdd` — continue from the established red tests, one criterion per test.
- `diagnose` — for regressions, especially countdown/refetch or preserved Weaver handlers.
- `code-review` — applicable before committing; its instructions explicitly authorize parallel review agents. Otherwise do not spawn subagents under the harness rules. No subagents were used this session.
