## Agent skills

### Tech Stack & Tooling

- **Language**: TypeScript (`tsconfig.json`, target `ES2022`, module resolution `NodeNext`).
- **Type Checking**: Run `npm run check` (`tsc --noEmit`) regularly to ensure zero type errors.
- **Testing**: Run `npm test` (`node scripts/run-tests.mjs`) to execute unit tests. It runs `tsx --test` on the non-browser files concurrently, then on the real-Chrome files one at a time.
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

### Guest UI work (kit, walkthrough and captures)

Any change to a guest screen (chat workspace or standalone page) follows the guest UI consistency effort in `.scratch/guest-ui-consistency/` (`PRD.md`, `map.md`, `design/`, canvas <https://claude.ai/artifact/TKQCWTF4SWNscKrjLkN1zX>).

- **Use the kit, don't invent components.** The component list is in `docs/design/shortlet-design-system-direction.md` ("Guest UI kit"). CSS is the "Guest UI kit" block of `apps/web/src/shortlet-foundations.css`, server markup helpers are in `apps/local-guest/src/guest-kit.ts`, and copy/labels come from `apps/web-agent/src/guest-content.ts` (`GUEST_FACT_LABELS`). Chat and the standalone page must render the same content from the same helper. Use semantic tokens only (no hex, no page-level `style:` strings); dark mode comes from the tokens. Keep the committed CSS formatting: the foundation tests match it with regexes, so do not run a formatter over `shortlet-foundations.css`.
- **Run the app to see it.** `npx tsx .scratch/guest-ui-consistency/walkthrough.ts` serves one local guest per booking stage on fixed ports 3021+ (local test data only); `node .scratch/guest-ui-consistency/start-walkthrough.mjs` starts it detached and logs to `walkthrough-06.log` (delete the log afterwards). Prefer `withStagePage` / `withRequestScreen` in `test/helpers/` for tests.
- **Capture and check screens.** Every UI issue ends with screenshots at 320, 390, 768 and 1280 plus a check for horizontal overflow and controls under 44px (ADR 0078):
  - `capture.ts name=url ...`: quick light-theme captures of any URLs.
  - `capture-07.ts`, `capture-08.ts`, `capture-09.ts`, `capture-10.ts`: the request, offer, payment and confirmation/system screens (page and chat), asserting reflow and targets. Copy one as the starting point for a new screen group.
  - `capture-11-all.sh` (runs `capture-11.ts` once per screen group): the full sweep of every design screen, light and dark, into `screenshots/final/`, with `findings-*.txt`. Run groups in separate processes; two fixtures in one process break the shell load. Re-run it after any shared CSS or shell change.
  - Save new captures under `screenshots/<issue number>/`. Hidden native radio inputs report as 1x1; their labels are the 44px targets.
- **Desktop split and clean-up rules.** At 64rem+ an open workspace sits beside a ~460px conversation (workspace 560px, discovery 760px); `.waiting-panel`, `.stay-result` and page-level payment style strings are retired (`test/guest-retired-classes.test.ts`). `.stay-card` and `.stay-grid` remain only as client hooks.
- **Browser phase of `npm test` takes about 12 minutes.** Run it in the background with a long timeout, and never run two browser suites or capture sweeps at once.
