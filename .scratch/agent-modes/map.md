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
| 1b | Agent Mark for the single stays mode: glyph, states, hero-to-app-bar transition, reduced motion, human state (analysis 9.1–9.2); human state defined but unwired until takeover reaches guests | [01b](issues/01b-agent-mark-for-the-stays-mode.md) | ready-for-human (merged at 9fb6519; DoD 7 literal zero-failure run not met, accepted failure list pending owner; owner item k open; see 01b Comments) |
| 3 | Domain-neutral pack contract (surface map, pack-owned state) | [03a](issues/03a-neutral-pack-contract.md) | ready-for-human (issue written 10 Nov; gated on owner release, ADR 0107 "Settled") |
| 3b | Persist the active task and task list (part 1), then per-task chat lanes in memory (part 2) | [03b](issues/03b-persist-active-task-and-task-list.md), [03d](issues/03d-per-task-lanes-in-memory.md) | ready-for-human (issues written 10 Nov; gated on owner release; O1 and O2 open in [seams](seams.md)) |
| 3c | Lane event rows (write-only), export coverage. The read-path table split (analysis 11.4) has no issue yet (O2) | [03e](issues/03e-lane-event-rows-and-export.md) | ready-for-human (issue written 10 Nov; gated on owner release; O4 open) |
| 4 | Mode follows the active task and the client applies it, `--mode-*` tokens (part 1). Client lane swap, View Transition, `theme-color` and announcer are not yet assigned. "Concierge · Stays" copy is in [03g](issues/03g-mode-preview-strip.md) | [03c](issues/03c-mode-follows-the-active-task.md) | ready-for-human (issue written 10 Nov; gated on owner release; O7 open) |
| 4b | Tier C mode suggestion (part 1). Tiers A and B stay disabled (ADR 0107 correction 3); keyword `#route` removed | [03f](issues/03f-tier-c-mode-suggestion.md) | ready-for-human (issue written 10 Nov; gated on owner release; O6 open) |
| 5 | Mode preview strip and sheet, preview only (part 1). Deep links and manifest shortcuts remain out of scope | [03g](issues/03g-mode-preview-strip.md) | ready-for-human (issue written 10 Nov; gated on owner release). Dependency graph and merge order: [seams](seams.md) |
| 6 | First real second domain | — | owner decision |
