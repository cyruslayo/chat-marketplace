# Issue tracker: Local Markdown

Issues and PRDs for this repository live as Markdown files in `.scratch/`.

## Conventions

- One effort per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append under a `## Comments` heading

## Publishing

When a skill says to publish to the issue tracker, create the appropriate file under `.scratch/<feature-slug>/`, creating the directory if needed. When a skill says to fetch a ticket, read the referenced local file.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Ticket type is recorded as `Type: research`, `prototype`, `grilling`, or `task`
- Ticket status is recorded as `Status: claimed` or `Status: resolved`
- Blocking edges use `Blocked by: NN, NN`
- The frontier is the first numbered open, unblocked, unclaimed issue
- Claim by setting `Status: claimed` before work
- Resolve by appending an `## Answer`, setting `Status: resolved`, and adding a context pointer to the map

## Definition of Done

An issue may only be set to `Status: resolved` when **all** of the following are true. Check each explicitly before resolving:

1. **Every acceptance criterion has a dedicated named test.** The test name must mirror the criterion text. A single `test()` block must not cover more than one acceptance criterion.
2. **Each test exercises the failure paths named in the criterion**, not just the happy path. If the criterion says "X cannot progress", there must be an assertion that X throws or returns an error.
3. **Every ADR that touches the domain has been listed and read.** Any ADR constraint that affected implementation decisions is cited in the commit message or a `## Comments` entry.
4. **No injected dependency is unused.** Every constructor parameter accepted by a new class is called somewhere in that class's implementation.
5. **No policy string, rule, or constant has been invented.** All hardcoded domain values are traceable to an ADR or `CONTEXT.md`. Unresolved gaps are noted and the user is asked.
6. **No bearer credential or restricted identity material appears in audit records or logs** (ADR 0075).
7. **Targeted checks pass.** Run the tests, type checks, and builds that cover the issue.
8. **Integrated verification passes before resolution.** Coordinated waves require one final full-suite run after all wave changes. Standalone issues require their full verification gate before resolution.
9. **Verification evidence is current.** Any relevant code change invalidates earlier wave verification and requires a new final gate.
10. **Failures receive diagnosis.** Report application failures separately. Do not retry the full suite automatically to diagnose a failure.

Run `npm test` for the complete two-phase suite. Use `npm run test:non-browser`, `npm run test:browser`, or `npm run test:files` for focused feedback. A passing focused run does not satisfy a coordinated wave's integrated full-suite gate.
