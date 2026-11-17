# Agent modes: map

Goal: switching Domain Packs changes the agent and the guest UI together (ADR 0107, accepted 8 Nov 2026).

- Analysis: [architecture-analysis.md](architecture-analysis.md)
- ADR: [0107 Present each Domain Pack as an Agent Mode](../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md)
- Playground: [playground/agent-mode-playground.html](playground/agent-mode-playground.html), published at <https://claude.ai/artifact/7QCKeeBUpDm12WpqH87HAA>
- Research: [Agent modes web technology](../../reports/Agent%20modes%20web%20technology.md), notes in `research_notes/Agent modes web technology/`
- Owner decisions, 8 Nov 2026 (ADR 0107, "Settled"): one concierge with domain capabilities; booking facts do not cross lanes automatically (a tap-to-use chip arrives with the second domain); slices 3–5 wait for the second-domain choice; switching starts at tier C.
- 3c storage follows ADR 0107 decision 11: one row per lane event, not `timeline_json`/`history_json` blobs (this supersedes analysis 11.4's table sketch).

| # | Slice | Issue | Status |
|---|---|---|---|
| 0 | ADR 0107 accepted, Agent Mode glossary entry | — | accepted (glossary entry landed with 01) |
| 1 | Render the shell from the stays mode, no visible change | [01](issues/01-render-the-shell-from-the-stays-mode.md) | resolved |
| 2 | Neutral platform preamble, persona in the pack (one concierge, "Concierge · Stays") | [02](issues/02-neutral-preamble-persona-in-the-pack.md) | resolved (8f1ad1a; full npm test and test:workers gate deferred to the batch) |
| 1b | Agent Mark for the single stays mode: glyph, states, hero-to-app-bar transition, reduced motion, human state (analysis 9.1–9.2); human state defined but unwired until takeover reaches guests | [01b](issues/01b-agent-mark-for-the-stays-mode.md) | resolved (merged at 9fb6519; owner accepted the known-failure set 16 Nov 2026, item k a recorded deviation; see 01b Comments) |
| 3 | Domain-neutral pack contract (surface map, pack-owned state) | [03a](issues/03a-neutral-pack-contract.md) | resolved (on main at 81367ed) |
| 3b | Persist the active task and task list (part 1), then per-task chat lanes in memory (part 2) | [03b](issues/03b-persist-active-task-and-task-list.md), [03d](issues/03d-per-task-lanes-in-memory.md) | resolved, both 03b and 03d (on main at 81367ed; O1, O2, O3 and O5 settled, see [seams](seams.md)) |
| 3c | Lane event rows (write-only), export coverage. The read-path table split (analysis 11.4) is [03h](issues/03h-lane-read-path-table-split.md) | [03e](issues/03e-lane-event-rows-and-export.md) | resolved (O4 and email masking settled by owner; see 03e Comments) |
| 4 | Mode follows the active task and the client applies it, `--mode-*` tokens (part 1). Client lane swap, View Transition, `theme-color` and announcer are not yet assigned. "Concierge · Stays" copy is in [03g](issues/03g-mode-preview-strip.md) | [03c](issues/03c-mode-follows-the-active-task.md) | resolved (on main at 81367ed; O7 settled: fixture CSS under `test/fixtures/`) |
| 4b | Tier C mode suggestion (part 1). Tiers A and B stay disabled (ADR 0107 correction 3); keyword `#route` removed | [03f](issues/03f-tier-c-mode-suggestion.md) | resolved (merged in gate/agent-modes-03-batch; O6 and O8 closed 16 Nov; two review defects and the recorded-journey re-record settled 17 Nov, see 03f Comments) |
| 5 | Mode preview strip and sheet, preview only (part 1). Deep links and manifest shortcuts remain out of scope | [03g](issues/03g-mode-preview-strip.md) | resolved (merged in gate/agent-modes-03-batch; see 03g Comments). Dependency graph and merge order: [seams](seams.md) |
| 6 | First real second domain | — | owner decision |
| 3c-read | Lane read path from per-task rows, building on 03e's write-only rows (analysis 11.4). Worth doing when the lane count grows (seam O2) | [03h](issues/03h-lane-read-path-table-split.md) | resolved (branch stack feat/agent-modes-03n..03j, 17 Nov 2026; owner decisions in 03h Comments; batch gate pending)undefined|
| 5-cache | Client lane cache and scroll memory, in memory only (ADR 0107 decision 11, analysis 11.5) | [03i](issues/03i-client-lane-cache-and-scroll-memory.md) | resolved (branch stack feat/agent-modes-03n..03j, 17 Nov 2026; owner decisions in 03i Comments; batch gate pending)undefined|
| 5-motion | Mode switch View Transition, feature-detected and typed `mode-switch` (ADR 0107 decision 7, analysis 5.5) | [03j](issues/03j-mode-switch-view-transition.md) | resolved (branch stack feat/agent-modes-03n..03j, 17 Nov 2026; owner decisions in 03j Comments; batch gate pending)undefined|
| 4-theme | Browser theme colour updated from the mode tokens on a switch (analysis 5.4) | [03k](issues/03k-mode-theme-color-switch.md) | resolved (on main at 7edd15f; owner decisions 17 Nov in 03k Comments; Android address-bar check is the owner's) |
| 4-announce | Mode switch announced through the existing polite announcer (ADR 0107 decision 7) | [03l](issues/03l-mode-switch-announcement.md) | resolved (on main at 7edd15f; owner decisions 17 Nov in 03l Comments; Android screen-reader check is the owner's) |
| O4-ddl | Move the platform-owned guest_threads and lane DDL out of the shortlet domain store (ADR 0101; seams O4 follow-up) | [03m](issues/03m-platform-thread-ddl-module.md) | resolved (branch stack feat/agent-modes-03n..03j, 17 Nov 2026; owner decisions in 03m Comments; batch gate pending)undefined|
| 0093-email | Mask the typed email in the existing thread timeline (ADR 0093; 03e OD-1 follow-up) | [03n](issues/03n-timeline-email-masking.md) | resolved (branch stack feat/agent-modes-03n..03j, 17 Nov 2026; owner decisions in 03n Comments; batch gate pending)undefined|

## Batch gate, 17 Nov 2026 (gate worktree `chat-marketplace-gate-03`, branch `gate/agent-modes-03-batch`)

Serial merges in the seams.md order: docs/agent-modes-map-status (f016de4), 03g (696d9f8), 03e (ff500a3), 03f at 218ee00 (587f47b), map rows resolved (1bb97ab), the 03g presentation-contract test updates (276e894), and the 03f 03a-seam fix d94efc3 (merged after). Result on the final tree:

- `npm run check` — clean. `npm run build` — clean.
- `npm run test:workers` — 30 files, 195 tests, all pass.
- Full `npm test` — phase 1 exit 0, zero failing tests; phase 2: 46 of 48 files pass; the only failures are the two known accepted commerce real-browser files, while commerce is not shipping. `mobile-guest-journey-chromium` AC28 (complete phone-only journey) passes — the 01b condition is met.
- `capture-11-all.sh` — all 21 screen groups clean (no horizontal overflow, no control under 44px, light and dark).
- Run-1 triage: `assistant-pack-registry` AC1 was a real seam regression (03f runtime importing web-agent copy) — fixed by injecting the copy from the composition roots (03f d94efc3, tier-c AC11 fail-closed); three tests asserting the bare pre-03g `/api/state` payload (`guest-conventional-search` AC4, `guest-new-conversation` AC1, `local-guest-shell` unknown-thread) were deliberate contract updates, recorded in the 03g issue. Back-office trio and `model-quota-host-recovery` were load flakes, green this run and solo.
