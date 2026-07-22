## Agent skills

### Tech Stack & Tooling

- **Language**: TypeScript (`tsconfig.json`, target `ES2022`, module resolution `NodeNext`).
- **Type Checking**: Run `npm run check` (`tsc --noEmit`) regularly to ensure zero type errors.
- **Testing**: Run `npm test` (`tsx --test test/*.test.ts`) to execute unit tests.
- **Coding standards**: See `docs/agents/coding-standards.md`. These rules are a hard gate — no `any` in domain types, no invented policy strings, no bearer credentials in logs, search before inventing a new pattern.

### Issue tracker

Issues and PRDs are tracked as local Markdown under `.scratch/shortlet-concierge-launch/issues/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md` for conventions and the **Definition of Done** checklist that must be satisfied before any issue is marked `resolved`.

### Triage labels

Use the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` states. See `docs/agents/triage-labels.md`.

### Domain docs & ADR Compliance

This repository uses a multi-context layout rooted at `CONTEXT-MAP.md`, with bounded contexts under `domains/` and `packages/`.

**CRITICAL: Architectural Decision Records (ADRs)**
System-wide architectural decisions are recorded in `docs/adr/`. Agents frequently fail by assuming domain logic instead of checking ADR constraints. To guarantee ADR compliance, agents MUST follow these steps for every implementation task:
1. **Discover:** List the contents of `docs/adr/` and read every ADR whose title or subject intersects with your domain. Do not skip this step.
2. **Acknowledge:** In your implementation plan, produce an explicit table: for each relevant ADR, state which constraint it imposes and which acceptance criterion or code path it affects.
3. **Map:** Before writing any code for an acceptance criterion, confirm which ADRs govern it. Write the ADR number in a comment at the callsite if the constraint is non-obvious.
4. **Verify:** After implementation, re-read the ADR table and confirm every constraint is reflected in the code. Never silently override an ADR.

See `docs/agents/domain.md` for the no-invented-logic rule, vocabulary standards, and ADR conflict guidance.

### Implementation protocol

Follow this sequence for every issue. Do not skip steps.

1. Read the issue, its "What to build" section, and every acceptance criterion.
2. List `docs/adr/` and read all ADRs that touch the domain. Record which apply and what they require.
3. Read the relevant `CONTEXT.md` and confirm all terms used in the issue are defined there.
4. Write failing tests — one `test()` per acceptance criterion, named to mirror the criterion text, covering both success and all named failure paths.
5. Implement until all tests pass and `npm run check` is clean.
6. Before resolving: self-review against the Definition of Done in `docs/agents/issue-tracker.md`. Check every item on that list explicitly.
7. Commit, then mark the issue `resolved`.
