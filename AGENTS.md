## Agent skills

### Tech Stack & Tooling

- **Language**: TypeScript (`tsconfig.json`, target `ES2022`, module resolution `NodeNext`).
- **Type Checking**: Run `npm run check` (`tsc --noEmit`) regularly to ensure zero type errors.
- **Testing**: Run `npm test` (`tsx --test test/*.test.ts`) to execute unit tests.

### Issue tracker

Issues and PRDs are tracked as local Markdown under `.scratch/shortlet-concierge-launch/issues/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` states. See `docs/agents/triage-labels.md`.

### Domain docs & ADR Compliance

This repository uses a multi-context layout rooted at `CONTEXT-MAP.md`, with bounded contexts under `domains/` and `packages/`. 

**CRITICAL: Architectural Decision Records (ADRs)**
System-wide architectural decisions are recorded in `docs/adr/`. Agents frequently fail by assuming domain logic instead of checking ADR constraints. To guarantee ADR compliance, agents MUST follow these steps for every implementation task:
1. **Discover:** Always list the contents of `docs/adr/` and read all ADRs that might affect your domain. Do not skip this step.
2. **Acknowledge:** Explicitly state in your plan which ADRs apply and exactly what constraints they impose on your implementation.
3. **Verify:** Map every acceptance criterion and feature detail directly to the relevant ADRs. Never silently override an ADR.

See `docs/agents/domain.md` for more details.

