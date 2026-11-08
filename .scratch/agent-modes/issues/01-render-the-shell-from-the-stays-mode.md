# Render the guest shell from the stays Agent Mode, with no visible change

Status: resolved
Type: task
Blocked by: none (ADR 0107 accepted 8 Nov 2026)
Requested: 8 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), slice 1. ADR 0107 (accepted).

## Why

The chat shell and the no-JS `/conversation` page hard-code stays copy, so a second Domain Pack cannot change what the guest sees without editing the shell (ADR 0107, Context).

- `apps/local-guest/src/guest-server.ts:577-612` (`renderGuestShellHtml`, which takes no arguments) writes all of these into the markup:
  - the empty-state heading "Find a place to stay" and its body
  - the starters "Explore Abuja" and "Explore Lagos" (`data-prompt`)
  - the composer `aria-label` "Message the concierge", label "Your message", placeholder "Area, dates, guests" and hint
  - the region labels "Current stay details" and "Your search", and the button "Return to your current stay details"
- `guest-server.ts:774` (the no-JS `/conversation` page) repeats the composer label, `aria-label` and hint.
- `apps/local-guest/src/client.ts:1881`, `:1887` and `:2599` hard-code "Your stay details are still here" and "Your stay details will stay here".
- `<html>` carries `data-theme="system"` (`guest-server.ts:330`) but no `data-mode`.
- No guest response tells the client which mode is active. `GuestTurnSuccess` and the state read (`apps/local-guest/src/shortlet-app.ts:360-400`) and the client's response type (`client.ts:145-152`) have `criteria`, `tasks` and `verticals`, but no `mode`.

This slice moves that copy into one stays presentation and renders the shell from it. **The guest sees no change.** Switching modes, the persona change and the generic pack contract are later slices.

## What to build

1. **Presentation type and stays copy.** In `apps/web-agent/src/guest-content.ts`, add a `ModePresentation` type and a frozen `GUEST_MODES.stays`. Its fields are listed in `architecture-analysis.md` section 5.2. Also add `workspace.returnedAnnouncement`, `workspace.readyAnnouncement` and `workspace.workingStatus` for the three `client.ts` strings. Every string is the **exact current text**, moved and not reworded. No new copy may be invented (Definition of Done item 5).
2. **Validation.** Add `validateModePresentation(value: unknown): ModePresentation | undefined` (fail closed). It accepts known keys only, non-empty strings within a bound, a kit icon name, and 1–4 starters. Put it beside the type, or in `guest-kit.ts` if that is where shared shell guards live. Use `unknown` and narrowing; no `any`.
3. **Kit helpers.** In `apps/local-guest/src/guest-kit.ts`, add `emptyStateHtml(mode)` and `composerHtml(mode, variant: "chat" | "page")`. They render the same element ids, classes and attributes the shell uses today (`#empty-state`, `.prompt-suggestion[data-prompt]`, `#composer`, `#composer-input`, `#composer-hint`). The chat shell and `/conversation` both call them (ADR 0077, ADR 0080).
4. **Shell.** `renderGuestShellHtml(mode: ModePresentation = GUEST_MODES.stays)` renders from the presentation, including the workspace and criteria labels, and sets `data-mode="${mode.id}"` on `<html>`. The no-JS conversation page takes the same presentation for its composer. Hosts (`guest-server.ts:3729`, the Cloudflare and pilot entries that call into it) pass nothing new and get stays.
5. **Responses carry the mode.** Add `mode?: ModePresentation` to `GuestTurnSuccess` and the state read. Set it to the default presentation on the assistant path and the non-assistant path alike, including on the assistant `getState` after a cold restore. The source is the composition root's default mode, which is stays for every host today. This slice does not read `activeTaskId`: with one pack it is always stays.
6. **Client.** Extend the response type and its validator (next to `isGuestVertical`) with `mode`. An invalid `mode` is rejected the way invalid `verticals` are. Replace the three hard-coded announcements with the copy from the last-applied presentation, falling back to `GUEST_MODES.stays` before the first response. **Do not** add view transitions, mode switching or token blocks here. Regenerate `apps/local-guest/dist/client.js` and commit only that file from `dist/`.
7. **CSS.** No change in this slice. The `--mode-*` token blocks arrive with switching (slice 4).
8. **Glossary.** Add **Agent Mode** to `packages/platform-core/CONTEXT.md` using the text in `architecture-analysis.md` section 10.

## ADRs to read first

ADR 0107 (this effort), 0099 (packs declare, platform renders), 0077 (one copy source), 0080 and 0081 (no-JS parity), 0078 (accessible profile), 0106 (cold restore: the mode must come back on assistant responses and after a restore), 0104 (no commerce work: do not touch `GUEST_VERTICALS.shopDescription` or the commerce pack). Also read the AGENTS.md sections "Guest UI kit" and "Concierge assistant path".

## Acceptance criteria

Each criterion gets its own `test()`, named after it.

1. **The stays presentation holds the current shell copy unchanged.** `GUEST_MODES.stays` equals the strings currently at `guest-server.ts:577-612`, `:774` and `client.ts:1881/1887/2599`. The test pins them literally.
2. **A malformed presentation is refused.** `validateModePresentation` returns `undefined` in each of these cases: an unknown key, a missing `id`, an empty heading, 0 or 5 starters, an over-long string, an unknown icon, and a non-object.
3. **The chat shell is rendered from the presentation.** With a test presentation (different strings, test-only), `renderGuestShellHtml(test)` shows the test heading, starters, placeholder, hint and region labels, and none of the stays strings.
4. **The default shell is unchanged.** `renderGuestShellHtml()` output equals the pre-change output apart from `data-mode="stays"` on `<html>`. Use a stored snapshot taken before the change, or the existing `local-guest-shell.test.ts` assertions plus the new attribute. `test/local-guest-shell.test.ts`, `guest-app-frame`, `guest-copy-pass`, `guest-new-conversation` and `guest-retired-classes` pass without edits to their assertions.
5. **The no-JS conversation page uses the same composer copy.** `/conversation` renders its composer label, `aria-label` and hint from the same presentation as the chat shell, through `composerHtml`.
6. **Every guest response carries the mode.** A turn, an event and a state read return `mode.id === "stays"` on the non-assistant path.
7. **The mode survives a cold restore on the assistant path.** On the `assistant-cold-journey` harness (assistant enabled, a new `LocalGuestApp` over the same store before every event, clock 2026-10-27, guest with no seeded phone or email), each response from search through payment handoff carries `mode.id === "stays"`.
8. **The client refuses an invalid mode.** A response whose `mode` fails validation is treated as an invalid response, as invalid `verticals` are today.

## Verification

- `npm run check`.
- `npx tsx --test` on the new test file, plus `test/local-guest-shell.test.ts`, `test/guest-app-frame.test.ts`, `test/guest-copy-pass.test.ts`, `test/guest-new-conversation.test.ts`, `test/guest-retired-classes.test.ts` and `test/assistant-cold-journey.test.ts`.
- Real Chrome, one at a time: `test/mobile-guest-journey-chromium.test.ts` (AC31 checks the shell landmarks and prompt controls) and `test/guest-task-rail-chromium.test.ts` (it renders the shell).
- UI evidence: run `capture-11-all.sh` and compare with `screenshots/final/`. There must be no visual diff at 320, 390, 768 or 1280, light or dark. Save to `.scratch/agent-modes/screenshots/01/`.
- Record the commands and pass counts under `## Comments`.

## Out of scope

- Mode switching, view transitions, `--mode-*` tokens, `theme-color`, and the mode switcher (slices 4 and 5).
- The persona and preamble change (slice 2), and the generic pack contract (slice 3).
- Adding an empty state or starters to the no-JS page. That would be a visible change: raise it as a follow-up if parity calls for it.
- Any commerce change.

## Comments

### Agent E, final verification (Agent modes issue 01)

Status at this entry: superseded by the final entry below (the visual comparison was later classified as noise).

Commands and pass counts (this run, commit 445a20d):

- `env -u LLM_API_KEY npx tsx --test test/mobile-guest-journey-chromium.test.ts`: 43 pass, 0 fail, 0 cancelled, 0 skipped (280.97 s). Run solo, no load flake.
- `env -u LLM_API_KEY npx tsx --test test/guest-task-rail-chromium.test.ts`: 1 pass, 0 fail, 1 skipped. The skipped test (AC3, capture overflow check) only runs with `SHORTLET_TASK_RAIL_BROWSER=1`.
- `SHORTLET_TASK_RAIL_BROWSER=1 env -u LLM_API_KEY npx tsx --test test/guest-task-rail-chromium.test.ts`: 2 pass, 0 fail, 0 skipped.
- `env -u LLM_API_KEY bash .scratch/guest-ui-consistency/capture-11-all.sh`: FINISHED, exit 0. Findings: no horizontal overflow; the only small controls are the hidden native `INPUT 1x1` radios on payment-choice (labels are the 44px targets, per AGENTS.md).
- Earlier, from the orchestrator's verified numbers: `npx tsx --test test/agent-mode-shell.test.ts` = 8 pass / 0 fail; `npx tsx --test test/local-guest-shell.test.ts test/guest-app-frame.test.ts test/guest-copy-pass.test.ts test/guest-new-conversation.test.ts test/guest-retired-classes.test.ts test/assistant-cold-journey.test.ts test/shortlet-design-system.test.ts` = 38 pass / 0 fail; `npm run check` exit 0.

Decisions recorded for this slice:

- The presentation uses the architecture-analysis 5.2 nested shape plus `composer.ariaLabel`.
- `persona.name` reuses the pack label "Stays" until slice 2.
- AC8 is a source-level test because `client.ts` cannot be imported in node.
- `test/shortlet-design-system.test.ts` line 120 regex was updated for `data-mode`.
- "Edit search" and "Done" at `client.ts` ~2321 stay as client strings (follow-up: move them to the presentation in slice 4).
- The build rewrote line endings in five tracked files (`apps/cloudflare/public/_headers`, `apps/local-guest/dist/gallery.js`, `landing.js`, `offer.js`, `payment.js`); they are left unstaged and not committed.

Visual evidence (NOT a pass):

- The sweep rewrote 219 tracked files under `.scratch/guest-ui-consistency/screenshots/final/` (PNGs and findings). They are left unstaged. Baseline copy was taken before the run.
- Byte compare: 219 of 285 files differ. Pixel compare (sharp, decoded RGBA): 66 of 264 PNGs identical; 198 differ, 30 of them by page height.
- The committed baseline was captured on 2026-10-02 (commit 639e3cd). Guest UI commits since then (for example 1b448c4 on 2026-11-04) change the request screens: `request-draft-page-light-390` now shows an "Edit your request" panel and a different stage bar. Those screens are not touched by this issue's commits, but the run here cannot show that.
- Needed to close: a sweep at the pre-issue commit (ed201ef^), compared with the current run, to isolate this issue's pixel effect. Until then the criterion "no visual diff" is not demonstrated.
- The new captures are copied to `.scratch/agent-modes/screenshots/01/` (PNGs and findings files), unstaged.

Definition of Done (docs/agents/issue-tracker.md), not yet closed:

- Item 7 (`npm test` passes): not run per issue, per CLAUDE.md Test scope; it runs once per batch before merging to main.
- Items 1 to 6 were not re-audited by Agent E in this run.

### Agent E, baseline comparison (Agent modes issue 01)

Result (superseded by the final entry): FAIL, then reclassified as noise.

Setup: a detached base worktree at 7830f13 (pre-issue; same product code as ed201ef^), `node_modules` junctioned from the main checkout, `capture-11-all.sh` run there. Post-issue captures are in `.scratch/agent-modes/screenshots/01/` (264 PNGs and findings).

Comparison (sharp, decoded RGBA, all 264 PNGs):

- Identical pixels: 210. Differing: 54.
- Non-determinism check (base run vs base re-run of the same groups): 223 identical, 41 differing. The differing base-vs-base files cover chat-home-dark-320, chat-results (320 and 390), chat-unit-light-320, confirmed-*, manual-transfer-page, manual-waiting-page, bank-transfer-page. So the sweep is not byte-stable on those screens.
- Real diff not explained by the noise check: `chat-compare-light-320` and `chat-compare-light-390` differ base-vs-post and are identical base-vs-base. Viewed: the compare table (a discovery screen inside the shell) sits a few pixels higher in the post-issue capture, and the right edge shows a scrollbar strip. Not yet traced to a cause.
- Other base-vs-post differences with no base-vs-base difference in the same group: `manual-transfer-page-light-320` (92820 vs 1472 noise), `request-declined-chat-dark-320` (10740), `offer-live-page-light-320` (52). Not checked by eye.
- Findings: no horizontal overflow and no small controls, except hidden native `INPUT 1x1` radios on payment-choice (identical in both runs).
- The no-JS `/conversation` captures are identical to base (composer parity holds at the pixel level).

Needed to resolve: trace the `chat-compare` shift (and the `request-declined` and `manual-transfer` diffs) to the base commit or to the issue commits, then re-run. Do not resolve until those are explained or fixed.

Definition of Done (docs/agents/issue-tracker.md): not audited in this pass. Item 7 (`npm test`) is per batch, not per issue.

Git: no commit of screenshots or dist; the sweep's 219 tracked changes under `.scratch/guest-ui-consistency/screenshots/final/` remain unstaged; the base worktree `C:/AI2026/chat-marketplace-agent-modes-base` is left in place for the owner.

### Agent E, repeat-run result and Definition of Done audit (Agent modes issue 01)

Status at this entry (superseded): still not resolved; the final entry below resolves it.

Repeat runs (3 runs per side, base at 7830f13 and post at 445a20d, one process at a time, `npx tsx .scratch/guest-ui-consistency/capture-11.ts <group>`):

- `chat-compare-light-320` and `-390`: each side has two states. Base run 1 differs from runs 2 and 3 (247507 and 305281 pixel bytes); runs 2 and 3 match. Post has the same pattern. Base-run-N matches post-run-N only where the state matches. Classification: **noise** (bistable render, present in both trees).
- `manual-transfer-page-light-320`: base runs differ by 1461 to 1523 bytes from each other; post runs by 1334 to 1474. Same magnitude both sides. **Noise.**
- `request-declined-chat-dark-320`: base run 2 differs from runs 1 and 3 by 10740 bytes (run 1 vs 3 is 16). Post runs identical to each other. Base run 2 is identical to every post run; base runs 1 and 3 match each other only. Base-vs-base flip has the same 10740 magnitude as the earlier base-vs-post difference. **Noise.**
- `offer-live-page-light-320`: all pairs identical (0). The earlier 52-byte difference did not recur. **Noise.**
- Earlier base-vs-base re-run (7 groups) also showed non-determinism in chat-home-dark-320, chat-results, chat-unit-light-320, confirmed-*, manual-transfer-page, manual-waiting-page and bank-transfer-page.
- Verdict: no real visual difference shown. The shell HTML is byte-identical apart from `data-mode` (AC4), and the client change is the validator plus three announcement strings. This is a repeat-run result, not an element-level proof.

Definition of Done (docs/agents/issue-tracker.md):

1. Every AC has a dedicated named test (AC1 to AC8 in `test/agent-mode-shell.test.ts`, plus the cold-journey AC7). **Met**.
2. Failure paths exercised. **Not met for AC8**: it asserts the rejection branch exists in `client.ts` source (the STOPGAP at the test's comment), not that a bad mode is rejected at run time. AC2 covers its refused cases. AC7 and AC6 have no failure path in the criterion text. Needs a node-importable validator (or a browser test) to close.
3. ADRs listed and read: ADR 0107 read in full this pass; 0077, 0078, 0080, 0081, 0099, 0104 and 0106 headers and decision sections skimmed, not read in full. ADR constraints affecting this slice: 0107 decisions 1, 2, 3, 5, 6, 7; the other ADRs were not cited in code. **Partly met.** Full reading of 0077/0080/0106 still needed before this can be ticked.
4. No unused injected dependency. Not audited in this pass. **Not checked**.
5. No invented policy strings. The copy is moved verbatim (AC1 pins the strings). **Met for AC1 scope; not separately audited**.
6. No bearer credential or identity material in logs. The mode is public presentation copy; no log lines added. **Met by inspection**.
7. `npm run check` passes: `npm run check` in this worktree, **exit 0** (tsc for root, apps/cloudflare, the test and tooling configs, plus the worker bundle guard). `npm test` passes: per batch, not per issue (CLAUDE.md Test scope). **Pending batch gate**.

Deferred per ADR 0107 decision 3: validation of a mode id against a `--mode-*` token block is slice 4 (no token blocks in this slice).

Worktree note: `git status` of `C:/AI2026/chat-marketplace-agent-modes` also lists tracked modifications under `.scratch/multi-domain-platform/screenshots/26/` and `.scratch/ui-recovery/recovered/` that this step did not write. Owner to check.

### Agent E, final verification and resolution (Agent modes issue 01)

Status: **resolved**. Head at the time of the audit: `d8cf4d0` (AC8 behavioural). The earlier entries above are superseded by this one.

**Commands and pass counts (run in this worktree on d8cf4d0):**

- `env -u LLM_API_KEY npx tsx --test test/agent-mode-shell.test.ts`: **9 pass, 0 fail** (AC1 to AC8, plus the AC8 wiring test).
- `env -u LLM_API_KEY npx tsx --test test/local-guest-shell.test.ts test/guest-app-frame.test.ts test/guest-copy-pass.test.ts test/guest-new-conversation.test.ts test/guest-retired-classes.test.ts test/assistant-cold-journey.test.ts test/shortlet-design-system.test.ts`: **38 pass, 0 fail**.
- `env -u LLM_API_KEY npm run check`: **exit 0** (root, `apps/cloudflare`, its test and tooling configs, and the worker bundle guard).
- Real Chrome, one file at a time, solo: `test/mobile-guest-journey-chromium.test.ts`: **43 pass, 0 fail**, 280.97 s (run at 445a20d). `test/guest-task-rail-chromium.test.ts`: without the env flag 1 pass and 1 skipped (AC3 needs `SHORTLET_TASK_RAIL_BROWSER=1`); with `SHORTLET_TASK_RAIL_BROWSER=1`: **2 pass, 0 fail**.
- `npm test` (full suite) and `npm run test:workers`: not run per issue. CLAUDE.md Test scope runs them once per batch before merging to main.

**Capture comparison (classified as noise).** The sweep (`bash .scratch/guest-ui-consistency/capture-11-all.sh`) on the post-issue head found no horizontal overflow and no controls under 44px, except the hidden native `INPUT 1x1` radios on payment-choice (their labels are the 44px targets, per AGENTS.md). The pixel comparison against a pre-issue base worktree at `7830f13` gave 210 of 264 PNGs identical and 54 differing. Every differing file has a base-vs-base difference of the same kind, so none is attributed to the issue. Repeat runs, three per side, for the five screens with no base-vs-base difference, classify them all as noise:

| screen | base vs base (1v2, 1v3, 2v3) | post vs post (1v2, 1v3, 2v3) | base vs post | class |
|---|---|---|---|---|
| chat-compare-light-320 | 247507, 247507, 0 | 247507, 247507, 0 | 0 or 247507 (matching render state) | noise (two render states, same in both trees) |
| chat-compare-light-390 | 305281, 305281, 0 | 305281, 305281, 0 | 0 or 305281 (matching render state) | noise |
| manual-transfer-page-light-320 | 1520, 1461, 1523 | 1405, 1334, 1474 | 1085 to 1502 | noise (same magnitude both sides) |
| request-declined-chat-dark-320 | 10740, 16, 10740 | 0, 0, 0 | 10740 or 0 (matching render state) | noise (base flips; post stable) |
| offer-live-page-light-320 | 0, 0, 0 | 0, 0, 0 | 0 | identical |

The other differing files were checked in an earlier base re-run: chat-home-dark-320 and chat-results (320 and 390) flip between runs in the base tree; chat-unit-light-320, confirmed-*, manual-transfer-page, manual-waiting-page and bank-transfer-page also flip between base runs. The shell HTML is byte-identical apart from `data-mode` (AC4), and the no-JS `/conversation` captures are identical to the base.

**Definition of Done (docs/agents/issue-tracker.md), audited for this issue:**

1. **Every AC has a dedicated named test: MET.** AC1 to AC8 each have one `test()`, named after the criterion text. AC8 has a second test (the wiring check), which makes 9 tests.
2. **Failure paths exercised: MET.** AC2 refuses the named malformed presentations. AC8 asserts that a bad mode throws `Invalid response mode` at run time (`assertValidResponseMode`, in `apps/local-guest/src/response-mode.ts`), and that absent and stays modes pass. AC6 and AC7 name no failure path in their criteria; AC7 asserts the mode after each cold restore. AC1, AC3, AC4 and AC5 are positive checks, as their criteria are.
3. **ADRs listed and read, constraints cited: MET.** Read in full this pass: 0107, 0077, 0078, 0080, 0081, 0099, 0104, 0106. Constraint and where the code satisfies it:
   - 0107 (governing): decisions 1, 2, 3, 5, 6 and 7 are implemented for this slice (presentation as a platform constant, server-derived default mode, closed validation, kit helpers, mode on every response, polite announcements). Decisions 4 (token blocks), 8 to 11 and the pack declaration path are deferred to slices 2 to 4, as the issue's out-of-scope list says.
   - 0077 (canonical artifacts): the mode is presentation only; shell copy moved verbatim (AC1); no artifact projection, price, deadline or consent text changed.
   - 0078 (accessible launch profile): no new controls; captures at 320, 390, 768 and 1280 show no horizontal overflow and no sub-44px targets except hidden radios; announcements use the existing polite announcer; copy stays en-NG.
   - 0080 (deterministic parity): no state transition added; the no-JS `/conversation` composer uses the same `composerHtml` helper (AC5).
   - 0081 (Weaver): no Weaver or A2UI type enters `packages/`, `domains/` or `guest-server.ts` (checked in the diff). The A2UI references in the diff are test-only types and the rebuilt `dist/client.js`.
   - 0099 (domain pack declares, platform renders): the presentation is a platform-side constant in `apps/web-agent/src/guest-content.ts`, read through the guest-kit helpers. No pack import is added. Pack-declared presentation is deferred to slices 2 and 3.
   - 0104 (commerce off): no commerce file is in the diff, `GUEST_VERTICALS.shopDescription` is untouched, and the default mode is stays.
   - 0106 (controls, cold restore): the mode is server-derived (composition default) and the client never sends it. It is carried on assistant responses and on the state read after a cold restore (AC6 and AC7).
4. **No unused injected dependency: MET.** The diff adds no class and no constructor. Each new helper is called: `renderGuestShellHtml(mode)`, `emptyStateHtml`, `composerHtml` (chat and page variants, in `guest-server.ts`; the landing page's use is unchanged from before the issue), `assertValidResponseMode` and `readResponseMode` (in `client.ts`), and `validateModePresentation`.
5. **No invented policy string, rule or constant: MET, with one gap noted for the owner.** Every presentation string is the existing copy, pinned literally by AC1. Three validator bounds are engineering limits, not domain policy, and are not traced to an ADR: `MODE_TEXT_MAX_LENGTH` = 400, `MODE_BODY_MAX_LENGTH` = 600 and `MODE_STARTERS_MAX` = 4 (1 to 4 starters, from the issue). ADR 0107 decision 3 asks for "bounded strings" without numbers. **The owner is asked to confirm these bounds.**
6. **No bearer credential or identity material in logs: MET.** The diff adds no log line. The mode carries presentation copy only.
7. **`npm run check` and `npm test` pass: PARTLY MET.** `npm run check` passes (exit 0, above). `npm test` is not run per issue (CLAUDE.md Test scope). It runs once per batch, and that batch gate is still pending.

**Decisions recorded for this slice:**

- The presentation uses the architecture-analysis 5.2 nested shape plus `composer.ariaLabel`.
- `persona.name` reuses the pack label "Stays" until slice 2.
- AC8 is behavioural through `assertValidResponseMode` in `apps/local-guest/src/response-mode.ts`, which node can import, so the client check is node-testable. The earlier source-level stopgap is gone. A wiring test covers the call in `client.ts`.
- `test/shortlet-design-system.test.ts` line 120's regex was updated for `data-mode`.
- "Edit search" and "Done" at `client.ts` ~2321 stay client strings. Follow-up: move them to the presentation in slice 4.
- The build rewrote line endings in five tracked files: `apps/cloudflare/public/_headers` and `apps/local-guest/dist/{gallery,landing,offer,payment}.js`. They are left unstaged and not committed.
- The sweep's changes under `.scratch/guest-ui-consistency/screenshots/final/` are left unstaged and not committed. The captures for this issue are in `.scratch/agent-modes/screenshots/01/`.
- Deferred from ADR 0107 decision 3: validation of a mode id against a `--mode-*` token block and the contrast test (slice 4).

**Git state of this worktree at resolution:** this entry is committed with the issue file, `.scratch/agent-modes/map.md` and `.scratch/agent-modes/screenshots/01/`. Not staged: the sweep's `screenshots/final` files, the five build files above, and tracked changes under `.scratch/multi-domain-platform/screenshots/26/` and `.scratch/ui-recovery/recovered/`, which this agent did not write.
