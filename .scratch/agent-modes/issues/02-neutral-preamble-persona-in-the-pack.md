# Name no domain in the platform preamble; the pack carries the concierge identity

Status: ready-for-agent
Type: task
Blocked by: none (can run beside 01)
Requested: 8 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 5.7 ("Persona"), slice 2. ADR 0107 decision 8 ("The platform preamble names no domain. The pack's prompt section carries the agent's identity").

## Decision taken (owner, 8 Nov 2026)

The agent is **one concierge with domain capabilities**, not a set of separately named personas. Guest-facing it reads "Concierge · Stays". This settles ADR 0107's open naming item. The guest-facing persona copy is slice 1b and 4's concern; this slice changes the model prompt only.

## Why

`ASSISTANT_PLATFORM_PREAMBLE` (`apps/local-guest/src/assistant/assistant-platform.ts:20`) is the "domain-agnostic" prefix to every pack's prompt (`composeSystemInstruction`, `:232`), but it says:

- "You are the Shortlet Guest Assistant."
- "You assist guests with discovering accommodation, answering questions about stays and pricing, and preparing booking actions."

Both are stays-specific. A second pack would inherit a stays identity.

## What to build

1. **Neutral preamble.** `ASSISTANT_PLATFORM_PREAMBLE` keeps only platform rules: the agent is the platform's concierge, uses tools for current facts and actions, and returns only the typed reply plan with no guest-facing prose. Keep the third sentence word for word. It names no domain, city, product or brand ("Shortlet", "stays", "accommodation", "booking").
2. **Identity in the pack.** `SHORTLET_PROMPT_SECTION` (`shortlet-assistant-pack.ts:47`) opens with the stays identity and scope, taken from the two lines removed from the preamble, so the composed stays instruction still tells the model what it is for. Do not reword the existing rules in the section.
3. **One concierge.** The identity line reads as the concierge working on stays, not a separate named agent ("Shortlet Guest Assistant" is retired). Keep "Shortlet platform" where the section already says it about authority ("The Shortlet platform and tools are authoritative").
4. **Stable per pack.** `ASSISTANT_SYSTEM_INSTRUCTION` and `composeSystemInstruction(pack)` stay pure string constants per pack, so prompt caching per pack still works. No turn-varying text enters them.

## ADRs to read first

ADR 0107 (decision 8), 0099 (the platform owns the Agent; packs supply the prompt section), 0106 (no keyword fast path; scope and date rules stay in the shortlet section unchanged), 0104 (do not touch the commerce pack's prompt beyond what the neutral preamble implies; if the commerce pack's section relied on the preamble's stays wording, note it in Comments and change nothing else).

## Acceptance criteria

Each gets its own `test()`, named after it.

1. **The platform preamble names no domain.** `ASSISTANT_PLATFORM_PREAMBLE` does not match `/shortlet|stay|accommodation|booking|lagos|abuja/i`, and it still contains the typed-reply-plan sentence.
2. **The stays instruction keeps its identity and rules.** `ASSISTANT_SYSTEM_INSTRUCTION` states the stays purpose (discovering places to stay, stay questions and pricing, preparing booking actions), and every existing assertion in `test/shortlet-assistant-evals.test.ts` passes unedited.
3. **A stub pack gets no stays identity.** `composeSystemInstruction(stubPack)` (as in `test/assistant-pack-registry.test.ts:84`) contains no stays wording; that existing assertion passes unedited.
4. **The instruction is stable.** Composing the stays instruction twice gives identical strings, and it equals `ASSISTANT_SYSTEM_INSTRUCTION`.

## Verification

- `npm run check`.
- `npx tsx --test` on the new or changed test file plus `test/assistant-pack-registry.test.ts`, `test/shortlet-assistant-evals.test.ts` and `test/assistant-cold-journey.test.ts` (assistant enabled, cold restore before every event).
- If a recorded-model or eval fixture keys on the system instruction text, re-record only with the owner's approval and say so in Comments; do not edit fixtures to match.
- Record the commands and pass counts under `## Comments`.

## Out of scope

- Guest-facing persona copy, the Agent Mark and `ModePresentation.persona` (01, 1b).
- Cross-domain routing with the scope classifier (4b) and the generic pack contract (3).
- Any commerce change.

## Comments

### Agent I, implementation (Agent modes issue 02)

Status at this entry: `ready-for-agent`. Commits: `0aa4026` (tests, commit 1), `8f1ad1a` (implementation, commit 2), and the commit that carries this entry and the map row (commit 3).

**ADR table (step 1, read before code).** ADRs read: 0107 (decision 8 and "Settled by the owner"), 0099, 0104, 0106 (in full), and 0092 and 0093 (read for stays and account constraints).

| ADR | Constraint that applies here | Where it lands |
| --- | --- | --- |
| 0107 decision 8 | The platform preamble names no domain. The pack's prompt section carries the identity. | `assistant-platform.ts` `ASSISTANT_PLATFORM_PREAMBLE`; `shortlet-assistant-pack.ts` `SHORTLET_PROMPT_SECTION` opening |
| 0107 "Settled" (naming) | One concierge with domain capabilities, not a separately named persona. "Shortlet Guest Assistant" is retired. | Preamble says "the platform's concierge"; section says "Your focus is stays." |
| 0099 decision 4 | A pack declares its prompt section, and the platform consumes it. No pack imports platform internals. | The stays identity stays in the pack. `composeSystemInstruction` is unchanged. |
| 0104 decisions 1 and 5, 0099 decision 7 | Commerce stays off. The commerce pack is not changed here. | `commerce-assistant-pack.ts` untouched (see Deviations) |
| 0106 Replies | The typed reply plan rule is kept. | Preamble line 2, word for word from the old third line |
| 0106 Scope, Tools and context, Dates | Existing scope, tool, reference and date rules are not reworded. | `SHORTLET_PROMPT_SECTION` rules unchanged; `shortlet-assistant-evals` passes unedited |
| 0106 resource controls, and ADR 0107 decision 8 (stable per pack) | The instruction is a pure string per pack, with no turn-varying text. | `composeSystemInstruction`; AC4 |
| 0092, 0093 | No prompt-wording constraint. Extended-stay and guest-account rules are not touched. | None |

**Prompt diff (verbatim).**

Old preamble (`ASSISTANT_PLATFORM_PREAMBLE`):

```
You are the Shortlet Guest Assistant.
You assist guests with discovering accommodation, answering questions about stays and pricing, and preparing booking actions.
Use tools for current facts and actions. When you have no tool call, return only the requested typed reply plan. Do not write guest-facing prose.
```

New preamble:

```
You are the platform's concierge.
Use tools for current facts and actions. When you have no tool call, return only the requested typed reply plan. Do not write guest-facing prose.
```

Old opening of `SHORTLET_PROMPT_SECTION`: `The Shortlet platform and tools are authoritative.`

New opening of `SHORTLET_PROMPT_SECTION` (the first line is new; the second is the old first line, unchanged):

```
Your focus is stays. You assist guests with discovering accommodation, answering questions about stays and pricing, and preparing booking actions.
The Shortlet platform and tools are authoritative.
```

No other prompt rule changed. The `shortlet-assistant-pack.ts` diff adds one line. The preamble diff removes two lines and keeps the third.

**Other files that referenced the removed wording (grep; none changed).**

- `docs/testing/shortlet-assistant-v1.md` (title and body), `docs/testing/local-guest-weaver-demo.md:26`, `HANDOFF.md:1,15` and `.scratch/pr_body.md:3` name the product or an old v1 release ("Shortlet Guest Assistant v1"). They are documentation, not the prompt, so they stay as they are.
- `.scratch/agent-modes/architecture-analysis.md:23,32` and `docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md:20` describe the state before this issue. They stay as they are.
- Tests: no test asserted "Shortlet Guest Assistant" or the old preamble sentence. `test/assistant-pack-registry.test.ts:84` compares against `ASSISTANT_PLATFORM_PREAMBLE` by reference, so it passes unedited.
- Recorded fixtures: a repository-wide search for "Use tools for current facts" and "discovering accommodation" finds no fixture or recording. `test/assistant-recording-clients.test.ts` asserts that the system instruction is never persisted. No fixture was edited or re-recorded.
- Commerce: `commerce-assistant-pack.ts` has its own `promptSection` and does not use the preamble's stays wording. Its composed instruction now starts with "You are the platform's concierge." instead of the Shortlet persona. The commerce section is unchanged.

**Verification (exact commands and counts).**

1. Commit 1, tests before implementation: `env -u LLM_API_KEY npx tsx --test test/assistant-neutral-preamble.test.ts test/assistant-pack-registry.test.ts`: tests 7, pass 4, fail 3. The three failures are AC1, AC2 and AC3 (domain wording in the preamble, the retired persona, and the stub composition). AC4 passed already and guards the stable instruction. The registry tests passed.
2. Implementation: `env -u LLM_API_KEY npm run check`: exit 0 (root `tsc --noEmit`, `apps/cloudflare`, `tsconfig.test.json`, `tsconfig.tooling.json`, and the Worker bundle guard).
3. `env -u LLM_API_KEY npx tsx --test test/assistant-neutral-preamble.test.ts test/assistant-pack-registry.test.ts test/shortlet-assistant-evals.test.ts test/assistant-cold-journey.test.ts`: tests 63, pass 63, fail 0, cancelled 0. The cold journey ran with the assistant runtime enabled and a cold restore before every event.
4. Other files that import the changed symbols or assert prompt wording: `env -u LLM_API_KEY npx tsx --test test/assistant-reply-plan-references.test.ts test/assistant-search-unknowns.test.ts test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/commerce-agent-tools.test.ts`: tests 42, pass 42, fail 0.
5. After a comment-only edit to the preamble's doc comment (ADR 0107 decision 8 reference): `npx tsx --test test/assistant-neutral-preamble.test.ts test/assistant-pack-registry.test.ts`: tests 7, pass 7; `npx tsc --noEmit`: exit 0.
6. Not run, by the batch rule: full `npm test` and `npm run test:workers` (the pre-merge gate, once per batch).

**Definition of Done (`docs/agents/issue-tracker.md`), item by item.**

1. Every acceptance criterion has a dedicated named test: met. AC1 to AC4 are each one `test()` in `test/assistant-neutral-preamble.test.ts`, named after the criterion.
2. Failure paths are asserted: met. AC1 asserts the preamble has no domain words. AC2 asserts the retired persona is absent. AC3 asserts the stub composition has no stays words. AC4 asserts the composed instruction is identical on each call.
3. ADRs listed and read, with constraints cited: met (table above).
4. No unused injected dependency: met. No constructor or parameter was added.
5. No invented policy string: met. The one new sentence ("Your focus is stays.") restates the two removed preamble lines. No threshold or rule was added.
6. No credential or identity material in logs: not applicable to this change.
7. `npm run check` passes and `npm test` passes with zero failures: `npm run check` is met. `npm test` has not been run for this issue, because the test-scope rule runs it once per batch before merge. This item is not met yet, so the issue stays `ready-for-agent`.

**Result.** All four acceptance criteria are implemented and tested. The issue is not resolved only because DoD item 7 waits for the batch's pre-merge `npm test`.

**Deviations.**

- `test/assistant-pack-registry.test.ts` now imports `createStubPack` from `test/helpers/stub-domain-pack.ts` instead of defining `stubPack` locally. Its assertions are unchanged. The spec asked for the helper to be shared, not copied.
- The third preamble line is kept word for word (the typed-reply-plan sentence and "Do not write guest-facing prose").
- The preamble doc comment gained the ADR 0107 decision 8 reference, because the constraint is not obvious at the callsite.
