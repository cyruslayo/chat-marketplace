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
