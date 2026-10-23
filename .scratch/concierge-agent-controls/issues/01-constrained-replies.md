# Constrain replies through typed plans and authoritative facts

Status: claimed
Blocked by: none

## What to build

Implement control 1 from the approved research and ADR 0106.
The platform owns parsing and enforcement. Packs supply domain reply vocabulary and authoritative rendering.
Add provider-neutral structured response and output-token options to the model port.
Map them into the OpenAI-compatible adapter with local validation and explicit supported-parameter requirements for OpenRouter.
Do not change the selected model, provider defaults, or production configuration.
Keep compatible behavior for existing scripted/Gemini clients through safe server replies; never forward their arbitrary prose.
Keep all existing tool operations useful, including comparison, price questions, status, clarification, and pending proposals.
Use shared guest-content copy and the existing Weaver surface path.

## Acceptance criteria

- [ ] AC1: A model's arbitrary prose, price, confirmation, URL, or HTML cannot become a guest reply.
- [ ] AC2: Valid typed reply plans render current authorized facts and reject unknown kinds, extra fields, invalid references, and stale state.
- [ ] AC3: Discovery, details, comparison, price explanation, status, request drafts, and proposal replies remain useful through server-generated text.
- [ ] AC4: Invalid or legacy model replies preserve completed safe surfaces and use fixed safe copy; they never invent success or submit a transaction.
- [ ] AC5: Structured-output and output-token options reach the provider adapter without putting vendor types in the neutral/domain interfaces.
- [ ] AC6: Existing pending confirmation/cancellation and conventional routes retain their behavior; focused assistant and adapter checks pass.

## ADR compliance

Use PRD's ADR map, especially 0015, 0068, 0072, 0075, 0077–0080, 0089, 0099, 0102, and 0106.
Public test seams: `AssistantRuntime.handleTurn`, model adapter request/response boundaries, and real domain pack projections.
Use named tests before runtime edits. Test a rogue model through the actual runtime.
Do not weaken old assertions to accept missing facts or unsafe effects.

## Comments

Record red/green commands and counts, changed paths, commit, remaining gaps, and Definition of Done checks.
UI captures are consolidated after all five controls; this issue remains part of a claimed batch until that gate passes.

### Issue 01 implementation evidence — 23 October 2026

The issue remains `claimed`. I implemented only constrained replies and provider output options.

Implementation commit: `193caa1d0e2b3f3175890ac9fcd5491ee22e0d52`.

The platform requests a closed typed reply plan with a configurable output-token bound. It validates the plan locally and discards model prose and final opaque provider steps. Shortlet and Commerce packs render fixed shared copy from successful current operation results. Invalid references, failed operations, malformed plans, and legacy prose use safe server copy. Existing Weaver projections and command paths remain in place.

The first red run used `npx tsx --test --test-name-pattern='AC1:|AC2:|AC4:' test/shortlet-assistant-evals.test.ts`. AC1 and AC2 failed because raw model text and JSON reached the guest. AC4 also failed because its initial fake used invalid search argument names; I corrected the fixture before the green runs.

The protocol test originally expected model-authored `Authoritative search complete.`. I changed it to expect the server-generated current search summary. Its Gemini tool-call, signed-thought, and function-result continuity assertions remain active.

| ADR | Constraint applied | Affected path or criterion |
| --- | --- | --- |
| 0015 | The server supplies current All-In Stay Totals; comparison puts totals before nightly rates. | AC2, AC3; Shortlet reply rendering |
| 0068 | Model request options remain provider-neutral; adapters own provider serialization. | AC5; model and OpenAI-compatible adapter |
| 0069 | Keep the pinned interaction profile and structured event behavior. | AC6; protocol tests |
| 0070 | Thread and domain identities remain separate; provider raw steps are retained only for tool-call continuity without model text. | AC1, AC6; model history |
| 0071 | Keep interaction projections redacted and subordinate to committed state. | AC1, AC4; reply history |
| 0072 | Consequential operations keep their existing platform command gate. | AC4, AC6; proposal and confirmation paths |
| 0073 | Model plans cannot create components, schemas, URLs, or actions. | AC1, AC2; typed plan boundary |
| 0074 | Invalid plans retain safe text and existing workflow state. | AC2, AC4; safe fallback |
| 0075 | Do not persist rejected model prose or final opaque steps. | AC1; conversation history |
| 0076 | This change does not bypass human ownership or resume behavior. | AC6; command path |
| 0077 | Shared guest copy and current authoritative artifacts remain the presentation source. | AC3; shared guest-content helpers and Weaver surfaces |
| 0078 | Existing accessible surfaces and Nigerian English copy remain governed by the current kit. | AC3, AC6; no surface schema changes |
| 0079 | Keep provider failures observable without recording prompts or replies. | AC1, AC4; diagnostics remain metadata-only |
| 0080 | Conventional confirmation and cancellation routes remain available during model failure. | AC6; pending-action paths |
| 0081 | Weaver stays a replaceable presentation runtime over server projections. | AC3, AC6; surface path |
| 0089 | Payment and owner-payable state remain server-authoritative. | AC1, AC4, AC6; no model-created payment claims |
| 0099 | Platform validates plans; each active domain pack renders its own safe reply. | AC1–AC4; pack interface |
| 0101 | Platform task and thread ownership remains outside domain packs. | AC6; task registry |
| 0102 | Current catalogue and projection facts remain authoritative. | AC2, AC3; Shortlet results and surfaces |
| 0105 | Preserve the selected staging demo model, processor, and deployment defaults. | AC5, AC6; configuration unchanged |
| 0106 | Reply kinds and references are closed; no model prose can supply facts, prices, or authority. | AC1–AC6; platform plan parser and pack renderers |

The required contexts were `packages/platform-core/CONTEXT.md` and `domains/shortlet/CONTEXT.md`. I also read `docs/agents/domain.md` and all listed ADR files above.

The new output-token setting defaults to 128 tokens and accepts configured integers from 1 through 4096. ADR 0106 treats these as configurable engineering bounds, not domain policy. No model, provider, production, or demo default changed.

Named acceptance tests cover AC1 through AC6. AC2 checks unknown kinds, extra properties, stale references, and references to failed operations. AC6 checks cancellation and confirmation while the provider is unavailable, with no new model calls.

The first whole-file attempt timed out at 60 seconds. I added per-test cleanup for tracked SQLite environments and Happy DOM windows. The bounded whole-file run then passed all 49 tests in 57.1 seconds.

| Check | Command | Result |
| --- | --- | --- |
| Shortlet assistant evaluations | `npx tsx --test --test-timeout=90000 test/shortlet-assistant-evals.test.ts` | 49 passed, 0 failed; 57.1 seconds |
| Assistant protocol, pack registry, demo, Commerce, and adapter tests | `npx tsx --test --test-timeout=90000 test/commerce-agent-tools.test.ts test/assistant-interactions-protocol.test.ts test/assistant-pack-registry.test.ts test/demo-extended-assistant.test.ts test/openai-compatible-client.test.ts` | 37 passed, 0 failed; 13.0 seconds |
| TypeScript and Worker checks | `npm run check` | Passed; Worker bundle guard found no Node SQLite dependency |
| Whitespace validation | `git diff --check` | Passed |

Changed paths: `apps/local-guest/src/assistant/assistant-model.ts`, `assistant-platform.ts`, `assistant-runtime.ts`, `openai-compatible-client.ts`, `shortlet-assistant-pack.ts`, `commerce-assistant-pack.ts`, `apps/web-agent/src/guest-content.ts`, `test/assistant-interactions-protocol.test.ts`, `test/openai-compatible-client.test.ts`, `test/shortlet-assistant-evals.test.ts`, and `test/helpers/temporary-database.ts`.

I copied only `test/helpers/temporary-database.ts` from the original checkout. The clean baseline's `assistant-search-unknowns.test.ts` imports it, so this dependency repair makes `npm run check` pass. The source file uses an OS temporary directory and best-effort cleanup; it contains no secrets.

Definition of Done review:

1. Each acceptance criterion has a named test.
2. Named failure paths cover malformed plans, stale references, failed operations, unsafe replies, and pending action behavior.
3. Relevant ADRs and contexts are listed above and were read.
4. The runtime token option is consumed by every model request.
5. Copy comes from shared guest-content; token bounds are configurable engineering settings.
6. Rejected final prose and its opaque step do not enter trusted history.
7. `npm run check` and focused tests pass. Full `npm test`, Workers batch gates, and UI captures remain for the integrated five-control gate. This issue remains claimed pending independent review.
