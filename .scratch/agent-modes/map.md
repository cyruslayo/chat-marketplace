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
| 1b | Agent Mark for the single stays mode: glyph, states, hero-to-app-bar transition, reduced motion, human state (analysis 9.1–9.2); human state defined but unwired until takeover reaches guests | [01b](issues/01b-agent-mark-for-the-stays-mode.md) | ready-for-human (code and evidence done; not resolved: DoD 7 open, owner decisions k and l; see 01b Comments) |
| 2 | Neutral platform preamble, persona in the pack (one concierge, "Concierge · Stays") | [02](issues/02-neutral-preamble-persona-in-the-pack.md) | ready-for-agent |
| 3 | Domain-neutral pack contract (surface map, pack-owned state) | — | waiting on slice 6 decision |
| 3b | Per-task chat lanes: timeline and model history per mode, context isolation, migration of the single timeline (analysis 11) | — | waiting on slice 6 decision |
| 3c | `guest_thread_tasks` table split, export coverage, restore runbook (analysis 11.4) | — | waiting on slice 6 decision |
| 4 | Client mode switching and lane swap (cache, scroll memory), `--mode-*` tokens, view transition, test-only fixture pack | — | waiting on slice 6 decision |
| 4b | Automatic switching tiers A/B/C with undo and `assistant.mode.change.v1` (analysis 9.4; accepted; tier C only until thresholds are tuned) | — | waiting on slice 6 decision |
| 5 | Cycling strip (empty conversation) and app-bar mark sheet, deep-link start, manifest shortcuts (analysis 9.3) | — | waiting on slice 6 decision |
| 6 | First real second domain | — | owner decision |
