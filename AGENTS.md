## Agent skills

### Tech Stack & Tooling

- **Language**: TypeScript (`tsconfig.json`, target `ES2022`, module resolution `NodeNext`).
- **Type Checking**: Run `npm run check` (`tsc --noEmit`) regularly to ensure zero type errors.
- **Testing**: Run `npm test` (`tsx --test test/*.test.ts`) to execute unit tests.

### Issue tracker

Issues and PRDs are tracked as local Markdown under `.scratch/shortlet-concierge-launch/issues/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` states. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a multi-context layout rooted at `CONTEXT-MAP.md`, with bounded contexts under `domains/` and `packages/`, and system-wide ADRs under `docs/adr/`. See `docs/agents/domain.md`.
