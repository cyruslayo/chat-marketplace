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
