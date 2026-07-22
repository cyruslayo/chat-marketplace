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

### Common Agent Anti-Patterns (Do NOT do these)

Code reviewers frequently catch agents making the following mistakes. Prevent them proactively:
1. **Loose Negative Validation (Fail-Open):** When verifying identity or authorization, do not use loose truthy checks (e.g., `if (payload.id && payload.id !== expected)`). If a field is missing, it must **fail closed** (e.g., `if (!payload.id || payload.id !== expected)`).
2. **Static Projections for Time-Bound State:** If a domain entity has an expiry or deadline, its projection methods (`projectState`) MUST lazily evaluate that expiry against the current clock. Do not assume the entity will magically transition to "expired" in memory without a background cron or a lazy check.
3. **Hardcoding Policies:** Never hardcode thresholds (e.g., `riskScore < 50`) as magic numbers inside domain logic. Accept them as configurable constructor options (e.g., `options.riskScoreThreshold ?? 50`) or derive them from explicit policy documents.
4. **Duplicating Test Fixtures:** Do not copy-paste complex `createEnvelope` or `createMock` functions across multiple test files. Extract them into shared test utility modules.
5. **Silencing with `any`:** `any` casts in the domain layer are strictly forbidden. Use `unknown` with narrowing guards or define explicit interfaces (e.g., `interface UnitRecord`) when dealing with loosely-typed repository returns.

### Implementation protocol

Follow this sequence for every issue. Do not skip steps.

1. Read the issue, its "What to build" section, and every acceptance criterion.
2. List `docs/adr/` and read all ADRs that touch the domain. Record which apply and what they require.
3. Read the relevant `CONTEXT.md` and confirm all terms used in the issue are defined there.
4. Write failing tests — one `test()` per acceptance criterion, named to mirror the criterion text, covering both success and all named failure paths.
5. Implement until all tests pass and `npm run check` is clean.
6. Before resolving: self-review against the Definition of Done in `docs/agents/issue-tracker.md`. Check every item on that list explicitly.
7. Commit, then mark the issue `resolved`.
