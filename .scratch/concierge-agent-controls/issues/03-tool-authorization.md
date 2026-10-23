# Enforce tool schemas, turn capabilities, and authorized references

Status: claimed
Blocked by: 02

## What to build

Implement control 3 and ADR 0106 at the platform tool-execution boundary.
Treat classifier and planner output as untrusted suggestions.
Validate the complete declared schema locally, including required fields, nullable types, ranges, arrays, and extra properties.
Intersect active-pack tools, current-state tools, validated turn capabilities, and server authorization.
Keep principal, tenant, guest, and command context server-owned.
Retain current domain eligibility, capacity, price, reference, stale-action, confirmation, concurrency, and idempotency checks.
Route consequential effects through the existing platform command gate; do not create a parallel authorization system.
Do not add approval prompts to authorized public reads.

## Acceptance criteria

- [ ] AC1: Unavailable tools, unknown names, extra arguments, missing fields, invalid types, and invalid ranges produce recoverable tool errors without effects.
- [ ] AC2: A classifier that approves an attack cannot grant another pack's tools, admin actions, or capabilities outside the validated turn.
- [ ] AC3: Forged guest/tenant identities and references outside the authorized current state cannot read or mutate another guest's workflow.
- [ ] AC4: Price/date/eligibility checks and exact-effect confirmation remain enforced for draft and proposal operations.
- [ ] AC5: Stale surfaces, changed facts, duplicate confirmations, and racing effects retain command-gate rejection and idempotency.
- [ ] AC6: Valid existing shortlet and development-commerce tool behavior remains supported; public commerce stays off.

## ADR compliance

Use PRD's ADR map and ADR 0106. Exercise real tool boundaries and observable domain effects with deliberately hostile model/guard doubles.

## Comments

Record commands, pass counts, commit, and Definition of Done evidence.

### Implementation evidence — 23 October 2026

The issue remains `claimed` pending independent review and the integrated five-control gate.

Implementation commit: `bae38ad513f3cdaa1d090330f364bd7f2785af67`.

The platform now validates model arguments against the complete tool schema before execution. The active pack maps validated turn intents to tools. The runtime intersects those capabilities with state-available tools and the pack's declared tool names. A task switch cannot grant the new pack's tools during the same turn. The next turn must classify again for that pack.

The platform retains the existing task tool path only for the explicit `task_switch` intent. Missing pack maps grant no pack tools. Unavailable state tools return their pack's existing validation message when available. Provider arguments never supply guest, tenant, principal, task, or command identity.

The first red run used `npx tsx --test --test-timeout=120000 test/assistant-tool-authorization.test.ts`. It reported 1 pass and 5 failures. The failures showed malformed calls executing, out-of-intent proposal execution, and identity fields reaching status operations. AC6's basic shortlet search passed before code changes.

| ADR | Constraint applied | Acceptance path |
| --- | --- | --- |
| 0015 | Keep prices and eligibility server-authoritative. | AC4; draft and proposal commands |
| 0068 | Keep provider and renderer details outside neutral tool contracts. | AC1–AC3; schema and platform boundary |
| 0069 | Preserve the pinned protocol and fail-closed event handling. | AC5; confirmation tests |
| 0070 | Keep interaction and domain identities separate. | AC3; no caller-supplied identity fields |
| 0071 | Keep interaction projections subordinate to committed state. | AC3–AC5; thread-local references |
| 0072 | Consequential effects use the existing platform command gate. | AC4, AC5; confirmation and stale-state checks |
| 0073 | Tools cannot create schemas, components, URLs, or actions. | AC1, AC2; pack tool declarations |
| 0074 | Unavailable actions and stale surfaces fail closed. | AC1, AC3, AC5; tool and surface validation |
| 0075 | Reject client-supplied ownership and omit restricted data from logs. | AC1, AC3; identity args and errors |
| 0076 | Keep human-owned workflows outside automation authority. | AC4, AC5; command paths remain unchanged |
| 0077 | Keep canonical interaction artifacts and projections. | AC4, AC6; existing surface path |
| 0078 | Preserve the existing accessible UI profile. | AC6; no surface or control-size changes |
| 0079 | Preserve safe observability without prompt or credential data. | AC1, AC5; existing metadata diagnostics |
| 0080 | Preserve deterministic routes and exact confirmation. | AC4–AC6; pending command gate |
| 0089 | Keep payment and owner-payable facts authoritative. | AC4; no direct tool payment |
| 0099 | Packs declare tool vocabulary; the platform enforces capabilities. | AC1, AC2, AC6; `toolIntentMap` and runtime intersection |
| 0101 | Platform owns task and thread state across domains. | AC2, AC6; task switch capability |
| 0102 | Keep current Shortlet projections and catalogues. | AC4, AC6; discovery and request paths |
| 0105 | Keep current demo defaults and public commerce disabled. | AC6; no deployment or configuration changes |
| 0106 | Treat classifier and planner output as untrusted suggestions. | AC1–AC6; local schema, state, capability, and command checks |

The checked contexts were `packages/platform-core/CONTEXT.md`, `domains/shortlet/CONTEXT.md`, and `domains/commerce/CONTEXT.md`. I also read `docs/agents/domain.md` and `docs/agents/coding-standards.md`.

Verification ran with `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`.

| Check | Command | Result |
| --- | --- | --- |
| New authorization tests | `npx tsx --test --test-timeout=120000 test/assistant-tool-authorization.test.ts` | 6 passed, 0 failed |
| Existing Shortlet, scope, persistence, protocol, pack, task, demo, Commerce, and reply tests | `npx tsx --test --test-timeout=120000 test/assistant-tool-authorization.test.ts test/shortlet-assistant-evals.test.ts test/assistant-scope-controls.test.ts test/assistant-scope-persistence.test.ts test/assistant-reply-coverage.test.ts test/assistant-interactions-protocol.test.ts test/assistant-pack-registry.test.ts test/assistant-task-rail.test.ts test/demo-extended-assistant.test.ts test/commerce-agent-tools.test.ts` | 99 passed, 0 failed; 59.5 seconds |
| Date provenance, draft/request authorization, stale price, current price, and duplicate confirmation regressions | `npx tsx --test --test-timeout=90000 --test-name-pattern='Context-invalid get_unit_details|get_unit_details rejects a Unit reference|Eval 17:|Offer acceptance revalidates|Checkout confirmation derives|Eval 8:|Eval 12:' test/shortlet-assistant-evals.test.ts` | 7 passed, 0 failed |
| Public Commerce gate | `npm run test:workers -- apps/cloudflare/test/commerce-market.spec.ts` | 40 passed, 0 failed |
| TypeScript and Worker graph checks | `npm run check` | Passed; Worker bundle guard found no Node SQLite dependency |
| Whitespace check | `git diff --check` | Passed |

Changed issue03 paths: `apps/local-guest/src/assistant/assistant-model.ts`, `assistant-platform.ts`, `assistant-runtime.ts`, `commerce-assistant-pack.ts`, `scope-classifier.ts`, `scripted-assistant-model.ts`, `shortlet-assistant-pack.ts`, `test/assistant-tool-authorization.test.ts`, `test/assistant-scope-controls.test.ts`, `test/commerce-agent-tools.test.ts`, `test/helpers/fake-domain-pack.ts`, this issue file, and `map.md`.

The existing unavailable-tool test asserts a current-shortlist message. The pack interface therefore exposes each declared tool schema separately from its state-filtered offered tools. The runtime validates arguments against that schema, then uses the pack precondition for its existing state-specific rejection. This preserves the tested message and blocks execution.

Definition of Done review:

1. Each acceptance criterion has a named test; AC1–AC6 are covered in the new authorization suite and Commerce flow tests.
2. Failure cases cover unknown names, unavailable state, malformed and extra arguments, missing fields, invalid types and ranges, invalid arrays, unvalidated intents, cross-pack calls, missing maps, forged identity fields, foreign references, stale price, stale eligibility, stale surfaces, and duplicate confirmations.
3. Relevant ADRs and contexts are listed above and were read.
4. No new injected dependency or authorization service was added.
5. Tool intent maps use the closed classifier vocabulary and existing domain tool names.
6. Errors use fixed messages and omit model arguments; invalid calls do not execute tools.
7. `npm run check`, the 99-test focused gate, and the Commerce Worker spec pass. Full `npm test` and the integrated all-Worker gate remain for the batch. The issue remains claimed pending independent review.
